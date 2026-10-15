import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import { body, param } from "express-validator";
import { AccessPass, BillingPayment, BillingSubscription, CommunityBlock, CommunityProfile, Member, Membership, PendingMemberRegistration, Plan, RegistrationRequest, Workout, sequelize } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { loginRateLimit } from "../middleware/loginRateLimit.js";
import { registrationRateLimit } from "../middleware/registrationRateLimit.js";
import {
  createMemberSession,
  createRegistrationVerificationToken,
  hashPassword,
  hashRegistrationVerificationToken,
  registrationVerificationLifetimeMs,
  verifyPasswordOrDummy,
} from "../services/memberAuth.js";
import {
  isEmailConfigured,
  isReservedEmailAddress,
  sendRegistrationReceivedEmail,
  sendRegistrationVerificationEmail,
} from "../services/welcomeEmail.js";
import {
  createSubscriptionAuthorization,
  getArgentinaDate,
  isMercadoPagoConfigured,
  isPaymentDemoMode,
} from "../services/mercadoPago.js";
import {
  accessPassLifetimeSeconds,
  createAccessPassToken,
  hashAccessPassToken,
} from "../services/accessPass.js";
import { decodeMemberProfilePhoto, memberPhotoUrl } from "../services/memberProfilePhoto.js";

const router = Router();

async function memberSummary(member) {
  const membership = await Membership.findOne({
    where: { memberId: member.id, status: "active" },
    include: [{ model: Plan, attributes: ["name"] }],
    order: [["endDate", "DESC"]],
  });

  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    status: member.status,
    phone: member.phone ?? "",
    address: member.address ?? "",
    profilePhotoUrl: memberPhotoUrl(member),
    membership: membership
      ? { planName: membership.Plan.name, endDate: membership.endDate }
      : null,
  };
}

async function sendRegistrationEmailResult(member, plan, paymentUrl) {
  if (isReservedEmailAddress(member.email)) {
    return {
      emailSent: false,
      emailWarning: "La dirección usa el dominio reservado .invalid y no puede recibir correos.",
    };
  }

  if (!isEmailConfigured()) {
    return {
      emailSent: false,
      emailWarning: "No pudimos enviar el correo de confirmación. Revisa tu dirección o contacta al gimnasio.",
    };
  }

  try {
    await sendRegistrationReceivedEmail({ member, plan, paymentUrl });
    return { emailSent: true };
  } catch (emailError) {
    console.error(
      "La inscripción se guardó, pero no se pudo enviar el correo de confirmación:",
      emailError.code ?? emailError.name,
    );
    return {
      emailSent: false,
      emailWarning: "No pudimos enviar el correo de confirmación. Revisa tu dirección o contacta al gimnasio.",
    };
  }
}

router.get("/plans", async (req, res, next) => {
  try {
    const plans = await Plan.findAll({
      where: { isActive: true },
      attributes: ["id", "name", "description", "durationDays", "price"],
      order: [["id", "ASC"]],
    });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.post("/checkin-qr", requireMemberSession, async (req, res, next) => {
  try {
    const token = createAccessPassToken();
    const result = await sequelize.transaction(async (transaction) => {
      const member = await Member.findByPk(req.member.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!member || member.status !== "active") {
        return { forbidden: "Necesitas una membresía activa para generar un QR de acceso." };
      }

      const today = getArgentinaDate();
      const membership = await Membership.findOne({
        where: {
          memberId: member.id,
          status: "active",
          startDate: { [Op.lte]: today },
          endDate: { [Op.gte]: today },
        },
        transaction,
      });
      if (!membership) {
        return { forbidden: "No tienes una membresía vigente para generar un QR de acceso." };
      }

      await AccessPass.destroy({ where: { memberId: member.id }, transaction });
      const expiresAt = new Date(Date.now() + accessPassLifetimeSeconds * 1000);
      await AccessPass.create(
        {
          memberId: member.id,
          tokenHash: hashAccessPassToken(token),
          expiresAt,
        },
        { transaction },
      );
      return { expiresAt };
    });
    if (result?.forbidden) {
      return res.status(403).json({ error: result.forbidden });
    }

    return res.status(201).json({
      token,
      expiresAt: result.expiresAt.getTime(),
      expiresInSeconds: accessPassLifetimeSeconds,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/login",
  [
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
    body("password").isString().isLength({ min: 8, max: 128 }),
  ],
  validateRequest,
  loginRateLimit,
  async (req, res, next) => {
    try {
      const member = await Member.unscoped().findOne({
        where: { email: req.body.email },
        attributes: ["id", "firstName", "lastName", "email", "status", "passwordHash", "profilePhotoUpdatedAt"],
      });
      const passwordMatches = await verifyPasswordOrDummy(
        req.body.password,
        member?.passwordHash,
      );

      if (!member || !passwordMatches) {
        return res.status(401).json({ error: "Correo o contraseña incorrectos." });
      }

      req.clearMemberLoginAttempts();
      const session = createMemberSession(member.id);
      return res.json({
        ...session,
        member: await memberSummary(member),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/me", requireMemberSession, async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.member.id);
    if (!member) {
      return res.status(401).json({ error: "La cuenta ya no está disponible. Inicia sesión nuevamente." });
    }
    return res.json({ member: await memberSummary(member) });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/me",
  [
    body("firstName").trim().notEmpty().isLength({ max: 80 }),
    body("lastName").trim().notEmpty().isLength({ max: 80 }),
    body("phone").isString().trim().isLength({ max: 30 }),
    body("address").isString().trim().isLength({ max: 200 }),
  ],
  validateRequest,
  requireMemberSession,
  async (req, res, next) => {
    try {
      const member = await Member.findByPk(req.member.id);
      if (!member) {
        return res.status(401).json({ error: "La cuenta ya no está disponible. Inicia sesión nuevamente." });
      }
      await member.update({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        phone: req.body.phone,
        address: req.body.address,
      });
      return res.json({ member: await memberSummary(member) });
    } catch (error) {
      return next(error);
    }
  },
);

router.put(
  "/me/photo",
  [
    body("photoData")
      .custom((value) => decodeMemberProfilePhoto(value) !== null)
      .withMessage("La foto debe ser un archivo JPEG válido de hasta 350 KB."),
  ],
  validateRequest,
  requireMemberSession,
  async (req, res, next) => {
    try {
      const member = await Member.findByPk(req.member.id);
      if (!member) {
        return res.status(401).json({ error: "La cuenta ya no está disponible. Inicia sesión nuevamente." });
      }
      await member.update({
        profilePhotoData: req.body.photoData.slice("data:image/jpeg;base64,".length),
        profilePhotoUpdatedAt: new Date(),
      });
      return res.json({ member: await memberSummary(member) });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/members/:memberId/photo",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  requireMemberSession,
  async (req, res, next) => {
    try {
      const member = await Member.unscoped().findByPk(req.params.memberId, {
        attributes: ["id", "status", "profilePhotoData"],
      });
      if (!member?.profilePhotoData) {
        return res.status(404).json({ error: "La foto de perfil no está disponible." });
      }

      if (member.id !== req.member.id) {
        const [viewer, profile, block] = await Promise.all([
          Member.findByPk(req.member.id, { attributes: ["id", "status"] }),
          CommunityProfile.findByPk(member.id, { attributes: ["isVisible"] }),
          CommunityBlock.findOne({
            where: {
              [Op.or]: [
                { blockedBy: req.member.id, blockedMemberId: member.id },
                { blockedBy: member.id, blockedMemberId: req.member.id },
              ],
            },
            attributes: ["id"],
          }),
        ]);
        if (viewer?.status !== "active" || member.status !== "active" || !profile?.isVisible || block) {
          return res.status(404).json({ error: "La foto de perfil no está disponible." });
        }
      }

      res.set({
        "Cache-Control": "private, no-store",
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      });
      return res.send(Buffer.from(member.profilePhotoData, "base64"));
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/workouts", requireMemberSession, async (req, res, next) => {
  try {
    const workouts = await Workout.findAll({
      where: { memberId: req.member.id },
      attributes: ["id", "method", "level", "routineName", "exercises", "feedback", "performedAt"],
      order: [["performedAt", "DESC"], ["id", "DESC"]],
      limit: 20,
    });
    return res.json({ workouts });
  } catch (error) {
    return next(error);
  }
});

router.get("/attendance-insights", requireMemberSession, async (req, res, next) => {
  try {
    const slots = await sequelize.query(
      `
        SELECT
          EXTRACT(ISODOW FROM (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires'))::INTEGER - 1 AS day,
          FLOOR(EXTRACT(HOUR FROM (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')) / 2)::INTEGER AS period,
          COUNT(*)::INTEGER AS visits
        FROM gym."Attendance"
        WHERE checked_in_at >= (
          date_trunc('week', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires') - INTERVAL '4 weeks'
        ) AT TIME ZONE 'America/Argentina/Buenos_Aires'
          AND checked_in_at < (
            date_trunc('week', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')
          ) AT TIME ZONE 'America/Argentina/Buenos_Aires'
        GROUP BY day, period
        ORDER BY day, period
      `,
      { type: QueryTypes.SELECT },
    );
    return res.json({ completeWeeks: 4, periodHours: 2, slots });
  } catch (error) {
    return next(error);
  }
});

router.get("/billing", requireMemberSession, async (req, res, next) => {
  try {
    const subscriptions = await BillingSubscription.findAll({
      where: { memberId: req.member.id },
      attributes: ["id", "status", "monthlyAmount", "currency", "createdAt"],
      include: [
        { model: Plan, attributes: ["name"] },
        {
          model: BillingPayment,
          attributes: ["id", "status", "amount", "currency", "approvedAt", "createdAt"],
          separate: true,
          order: [["createdAt", "DESC"]],
          limit: 20,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    const items = subscriptions.flatMap((subscription) => {
      const planName = subscription.Plan?.name ?? "Membresía";
      const payments = subscription.BillingPayments ?? [];
      const paymentItems = payments.map((payment) => ({
        id: `payment-${payment.id}`,
        status: payment.status,
        amount: Number(payment.amount),
        currency: payment.currency,
        description: `Membresía ${planName}`,
        createdAt: payment.createdAt,
        paidAt: payment.approvedAt,
      }));
      if (
        payments.length === 0 &&
        ["creating", "pending"].includes(subscription.status)
      ) {
        paymentItems.push({
          id: `subscription-${subscription.id}`,
          status: "pending",
          amount: Number(subscription.monthlyAmount),
          currency: subscription.currency,
          description: `Suscripción ${planName}`,
          createdAt: subscription.createdAt,
          paidAt: null,
        });
      }
      return paymentItems;
    });

    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/workouts",
  requireMemberSession,
  [
    body("method").isIn(["heavyDuty", "weider"]),
    body("level").isIn(["Principiante", "Intermedio", "Experto"]),
    body("routineName").trim().notEmpty().isLength({ max: 120 }),
    body("exercises").isArray({ min: 1, max: 30 }),
    body("exercises.*.name").trim().notEmpty().isLength({ max: 120 }),
    body("exercises.*.weightKg").isFloat({ min: 0, max: 2000 }),
    body("exercises.*.reps").isInt({ min: 1, max: 1000 }),
    body("feedback").trim().notEmpty().isLength({ max: 1000 }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const workout = await Workout.create({
        memberId: req.member.id,
        method: req.body.method,
        level: req.body.level,
        routineName: req.body.routineName,
        exercises: req.body.exercises.map((exercise) => ({
          name: exercise.name.trim(),
          weightKg: Number(exercise.weightKg),
          reps: Number(exercise.reps),
        })),
        feedback: req.body.feedback.trim(),
      });
      return res.status(201).json({ workout });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/registrations/checkout",
  [
    body("firstName").trim().notEmpty().isLength({ max: 80 }),
    body("lastName").trim().notEmpty().isLength({ max: 80 }),
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
    body("dni").trim().matches(/^\d{7,8}$/),
    body("address").trim().notEmpty().isLength({ max: 200 }),
    body("phone").optional({ nullable: true }).isString().isLength({ max: 30 }),
    body("planId").isInt({ min: 1 }),
  ],
  validateRequest,
  registrationRateLimit,
  async (req, res, next) => {
    try {
      const demoMode = isPaymentDemoMode();
      if (!isMercadoPagoConfigured() && !demoMode) {
        return res.status(503).json({
          error: "El pago en línea todavía no está habilitado. Contacta al gimnasio para completar tu inscripción.",
        });
      }
      if (!demoMode && !process.env.GYM_PUBLIC_URL) {
        return res.status(503).json({ error: "El checkout no está disponible porque falta configurar GYM_PUBLIC_URL." });
      }

      if (demoMode) {
        const plan = await Plan.findOne({
          where: { id: req.body.planId, isActive: true },
        });
        if (!plan) return res.status(404).json({ error: "No se encontró un plan activo." });
        if (plan.durationDays !== 30 || Number(plan.price) <= 0) {
          return res.status(400).json({ error: "El pago en línea solo está disponible para planes mensuales con precio mayor a cero." });
        }

        const demoUrl = `https://pago-de-prueba.ironcore.invalid/checkout/${randomUUID()}`;
        const emailResult = await sendRegistrationEmailResult(
          {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
          },
          plan,
          demoUrl,
        );

        return res.status(201).json({ demoMode: true, ...emailResult });
      }

      const result = await sequelize.transaction(async (transaction) => {
        const plan = await Plan.findOne({
          where: { id: req.body.planId, isActive: true },
          transaction,
        });
        if (!plan) return { notFound: "No se encontró un plan activo." };
        if (plan.durationDays !== 30 || Number(plan.price) <= 0) {
          return { invalidPlan: "El pago recurrente en línea solo está disponible para planes mensuales con precio mayor a cero." };
        }

        const member = await Member.create(
          {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            dni: req.body.dni,
            address: req.body.address,
            phone: req.body.phone ?? null,
            status: "inactive",
          },
          { transaction },
        );
        const subscription = await BillingSubscription.create(
          {
            memberId: member.id,
            planId: plan.id,
            externalReference: randomUUID(),
            monthlyAmount: plan.price,
            currency: "ARS",
            billingDay: 1,
            startDate: getArgentinaDate(),
          },
          { transaction },
        );
        return { member, plan, subscription };
      });

      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.invalidPlan) return res.status(400).json({ error: result.invalidPlan });

      try {
        const publicUrl = new URL(process.env.GYM_PUBLIC_URL);
        const backUrl = new URL("/", publicUrl);
        backUrl.searchParams.set("checkout", "mercadopago");
        const authorization = await createSubscriptionAuthorization({
          subscription: result.subscription,
          member: result.member,
          plan: result.plan,
          backUrl: backUrl.toString(),
        });
        const initPoint = new URL(authorization.initPoint);
        const validHosts = ["mercadopago.com", "mercadopago.com.ar"];
        if (
          initPoint.protocol !== "https:" ||
          !validHosts.some((host) => initPoint.hostname === host || initPoint.hostname.endsWith(`.${host}`))
        ) {
          throw new Error("Mercado Pago devolvió una dirección de autorización no válida.");
        }

        await result.subscription.update({
          providerSubscriptionId: authorization.providerSubscriptionId,
          initPoint: initPoint.toString(),
          status: authorization.status,
          nextPaymentDate: authorization.nextPaymentDate,
        });

        const emailResult = await sendRegistrationEmailResult(
          result.member,
          result.plan,
          result.subscription.initPoint,
        );

        return res.status(201).json({
          initPoint: result.subscription.initPoint,
          ...emailResult,
        });
      } catch (error) {
        await result.subscription.update({ status: "setup_failed" });
        console.error("No se pudo generar el checkout público de Mercado Pago:", error);
        return res.status(502).json({
          error: "No pudimos iniciar el pago. Contacta al gimnasio para completar tu inscripción.",
        });
      }
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/registrations",
  [
    body("firstName").trim().notEmpty().isLength({ max: 80 }),
    body("lastName").trim().notEmpty().isLength({ max: 80 }),
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
    body("dni").trim().matches(/^\d{7,8}$/),
    body("address").trim().notEmpty().isLength({ max: 200 }),
    body("phone").optional({ nullable: true }).isString().isLength({ max: 30 }),
    body("planId").isInt({ min: 1 }),
  ],
  validateRequest,
  registrationRateLimit,
  async (req, res, next) => {
    try {
      if (!isEmailConfigured() || isReservedEmailAddress(req.body.email)) {
        return res.status(503).json({
          error: "No se pudo iniciar la verificación por correo. Contacta al gimnasio.",
        });
      }

      let verificationUrl;
      try {
        verificationUrl = new URL(process.env.GYM_PUBLIC_URL);
      } catch {
        return res.status(503).json({
          error: "No se pudo iniciar la verificación por correo. Contacta al gimnasio.",
        });
      }
      if (
        !["http:", "https:"].includes(verificationUrl.protocol) ||
        (process.env.NODE_ENV === "production" && verificationUrl.protocol !== "https:")
      ) {
        return res.status(503).json({
          error: "No se pudo iniciar la verificación por correo. Contacta al gimnasio.",
        });
      }

      const { token, tokenHash } = createRegistrationVerificationToken();
      const pendingResult = await sequelize.transaction(async (transaction) => {
        await PendingMemberRegistration.destroy({
          where: { expiresAt: { [Op.lte]: new Date() } },
          transaction,
        });

        const plan = await Plan.findOne({
          where: { id: req.body.planId, isActive: true },
          transaction,
        });
        if (!plan) return { notFound: true };

        const existingMember = await Member.unscoped().findOne({
          where: { [Op.or]: [{ email: req.body.email }, { dni: req.body.dni }] },
          attributes: ["id"],
          transaction,
        });
        if (existingMember) return { accepted: true };

        const existingPending = await PendingMemberRegistration.findOne({
          where: { email: req.body.email },
          transaction,
        });
        if (existingPending) return { accepted: true };

        const pending = await PendingMemberRegistration.create(
          {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            dni: req.body.dni,
            address: req.body.address,
            phone: req.body.phone ?? null,
            planId: plan.id,
            tokenHash,
            expiresAt: new Date(Date.now() + registrationVerificationLifetimeMs),
          },
          { transaction },
        );
        return { pending, plan };
      });

      if (pendingResult.notFound) {
        return res.status(404).json({ error: "No se encontró un plan activo." });
      }
      if (pendingResult.accepted) {
        return res.status(202).json({ accepted: true });
      }

      verificationUrl.search = "";
      verificationUrl.hash = `verify-registration=${token}`;
      try {
        await sendRegistrationVerificationEmail({
          member: pendingResult.pending,
          verificationUrl: verificationUrl.toString(),
        });
      } catch (emailError) {
        await pendingResult.pending.destroy();
        console.error(
          "No se pudo enviar el correo de verificación:",
          emailError.code ?? emailError.name,
        );
        return res.status(503).json({
          error: "No se pudo enviar el correo de verificación. Intenta nuevamente más tarde.",
        });
      }

      return res.status(202).json({ accepted: true });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(202).json({ accepted: true });
      }
      return next(error);
    }
  },
);

router.post(
  "/registrations/verify",
  [
    body("token").isString().matches(/^[A-Za-z0-9_-]{43}$/),
    body("password").isString().isLength({ min: 8, max: 128 }),
  ],
  validateRequest,
  loginRateLimit,
  async (req, res, next) => {
    try {
      const tokenHash = hashRegistrationVerificationToken(req.body.token);
      const pending = await PendingMemberRegistration.findOne({
        where: {
          tokenHash,
          expiresAt: { [Op.gt]: new Date() },
        },
        attributes: ["id"],
      });
      if (!pending) {
        return res.status(400).json({
          error: "El enlace de verificación no es válido o venció. Inicia nuevamente la inscripción.",
        });
      }

      const passwordHash = await hashPassword(req.body.password);
      const verified = await sequelize.transaction(async (transaction) => {
        const lockedPending = await PendingMemberRegistration.findOne({
          where: {
            id: pending.id,
            tokenHash,
            expiresAt: { [Op.gt]: new Date() },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!lockedPending) return false;

        const member = await Member.create(
          {
            firstName: lockedPending.firstName,
            lastName: lockedPending.lastName,
            email: lockedPending.email,
            passwordHash,
            dni: lockedPending.dni,
            address: lockedPending.address,
            phone: lockedPending.phone,
            status: "inactive",
          },
          { transaction },
        );
        await RegistrationRequest.create(
          { memberId: member.id, planId: lockedPending.planId },
          { transaction },
        );
        await lockedPending.destroy({ transaction });
        return true;
      });

      if (!verified) {
        return res.status(400).json({
          error: "El enlace de verificación no es válido o venció. Inicia nuevamente la inscripción.",
        });
      }

      return res.json({ verified: true });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          error: "No se pudo completar la inscripción. Contacta al gimnasio para recibir ayuda.",
        });
      }
      return next(error);
    }
  },
);

export default router;
