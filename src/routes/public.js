import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { body, param } from "express-validator";
import { AccessPass, BillingPayment, BillingSubscription, Member, Membership, Plan, RegistrationRequest, Workout, sequelize } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { loginRateLimit } from "../middleware/loginRateLimit.js";
import {
  createMemberSession,
  hashPassword,
  verifyPasswordOrDummy,
} from "../services/memberAuth.js";
import {
  isEmailConfigured,
  isReservedEmailAddress,
  sendRegistrationReceivedEmail,
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
    console.error("La inscripción se guardó, pero no se pudo enviar el correo de confirmación:", emailError);
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
        attributes: ["id", "firstName", "lastName", "email", "status", "passwordHash"],
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
    body("password").optional().isString().isLength({ min: 8, max: 128 }),
    body("planId").isInt({ min: 1 }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const passwordHash = req.body.password
        ? await hashPassword(req.body.password)
        : null;
      const emailConfigured = isEmailConfigured();
      if (!emailConfigured && !passwordHash) {
        return res.status(503).json({
          error: "El envío de correos no está configurado. Contacta al gimnasio.",
        });
      }

      const registration = await sequelize.transaction(async (transaction) => {
        const plan = await Plan.findOne({
          where: { id: req.body.planId, isActive: true },
          transaction,
        });
        if (!plan) return null;

        const member = await Member.create(
          {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            passwordHash,
            dni: req.body.dni,
            address: req.body.address,
            phone: req.body.phone ?? null,
            status: "inactive",
          },
          { transaction },
        );
        const registrationRequest = await RegistrationRequest.create(
          { memberId: member.id, planId: plan.id },
          { transaction },
        );

        return { member, plan, registrationRequest };
      });

      if (!registration) {
        return res.status(404).json({ error: "No se encontró un plan activo." });
      }

      const emailResult = await sendRegistrationEmailResult(
        registration.member,
        registration.plan,
      );

      const response = {
        requestId: registration.registrationRequest.id,
        ...emailResult,
      };

      if (passwordHash) {
        const session = createMemberSession(registration.member.id);
        return res.status(201).json({
          ...session,
          ...response,
          member: await memberSummary(registration.member),
        });
      }

      return res.status(201).json(response);
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
