import { randomUUID, timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";
import { Router } from "express";
import { body, matchedData, param, query } from "express-validator";
import {
  Attendance,
  AccessPass,
  BillingPayment,
  BillingSubscription,
  CommunityReport,
  Member,
  Membership,
  Plan,
  Recipe,
  RegistrationRequest,
  sequelize,
} from "../models/index.js";
import { buildRecipeValues, recipeFields } from "../services/recipes.js";
import { validateRequest } from "../middleware/validate.js";
import {
  cancelMercadoPagoSubscription,
  createSubscriptionAuthorization,
  fetchMercadoPagoPayment,
  fetchMercadoPagoSubscription,
  getArgentinaDate,
  getBillingPeriod,
  getMercadoPagoEnvironment,
  isMercadoPagoConfigured,
  verifyMercadoPagoWebhook,
} from "../services/mercadoPago.js";
import {
  clearAdminSession,
  requireAdminSession,
  setAdminSession,
  sessionDurationSeconds,
} from "../middleware/requireAdminSession.js";
import {
  hashAccessPassToken,
  isAccessPassUsable,
} from "../services/accessPass.js";
import { sendPromotionalPush } from "../services/pushNotifications.js";

const router = Router();
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 8;

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

async function createMemberWithBilling(body) {
  const today = getArgentinaDate();
  return sequelize.transaction(async (transaction) => {
    const plan = await Plan.findOne({
      where: { id: body.planId, isActive: true },
      transaction,
    });
    if (!plan) return { notFound: "No se encontró un plan activo." };
    if (plan.durationDays !== 30) {
      return { invalidPlan: "El cobro recurrente solo está disponible para planes mensuales de 30 días." };
    }
    if (Number(plan.price) <= 0) return { invalidPlan: "El cobro recurrente requiere un plan con precio mayor a cero." };

    const member = await Member.create(
      {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        dni: body.dni,
        address: body.address,
        phone: body.phone || null,
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
        startDate: today,
      },
      { transaction },
    );
    return { member, plan, subscription };
  });
}

function membershipEndDate(startDate, durationDays) {
  return addDays(startDate, durationDays - 1);
}

const billingSubscriptionAttributes = [
  "id",
  "providerSubscriptionId",
  "initPoint",
  "status",
  "monthlyAmount",
  "currency",
  "billingDay",
  "startDate",
  "nextPaymentDate",
  "cancelledAt",
  "createdAt",
];

function mapProviderSubscriptionStatus(status) {
  if (status === "authorized") return "authorized";
  if (status === "paused") return "paused";
  if (status === "cancelled") return "cancelled";
  if (status === "finished") return "finished";
  return "pending";
}

async function handleMercadoPagoSubscriptionNotification(providerSubscriptionId) {
  const providerSubscription = await fetchMercadoPagoSubscription(providerSubscriptionId);
  if (typeof providerSubscription.external_reference !== "string") return;

  const subscription = await BillingSubscription.findOne({
    where: { externalReference: providerSubscription.external_reference },
  });
  if (!subscription || subscription.status === "cancelled") return;

  await subscription.update({
    providerSubscriptionId: String(providerSubscription.id),
    status: mapProviderSubscriptionStatus(providerSubscription.status),
    nextPaymentDate: providerSubscription.next_payment_date ?? null,
  });
}

async function handleMercadoPagoPaymentNotification(providerPaymentId) {
  const providerPayment = await fetchMercadoPagoPayment(providerPaymentId);
  const providerSubscriptionId =
    providerPayment.preapproval_id ?? providerPayment.metadata?.preapproval_id;
  if (providerSubscriptionId == null || providerPayment.id == null) return;

  const subscription = await BillingSubscription.findOne({
    where: { providerSubscriptionId: String(providerSubscriptionId) },
  });
  if (!subscription) return;

  const amount = Number(providerPayment.transaction_amount);
  const currency = providerPayment.currency_id;
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > Number(subscription.monthlyAmount) + 0.01 ||
    currency !== subscription.currency
  ) {
    throw new Error("El pago recibido de Mercado Pago no coincide con la suscripción.");
  }

  await sequelize.transaction(async (transaction) => {
    const lockedSubscription = await BillingSubscription.findByPk(subscription.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    let payment = await BillingPayment.findOne({
      where: { providerPaymentId: String(providerPayment.id) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const approvedAt = providerPayment.date_approved ?? null;
    const paymentStatus = providerPayment.status === "approved" ? "approved" : String(providerPayment.status);
    if (payment?.membershipId) {
      if (["cancelled", "refunded", "charged_back"].includes(paymentStatus) && payment.status === "approved") {
        await payment.update({ status: paymentStatus, amount, currency, approvedAt }, { transaction });
        await Membership.update(
          { status: "cancelled" },
          { where: { id: payment.membershipId }, transaction },
        );
      }
      return;
    }
    if (payment) {
      await payment.update(
        { status: paymentStatus, amount, currency, approvedAt },
        { transaction },
      );
    } else {
      payment = await BillingPayment.create(
        {
          billingSubscriptionId: lockedSubscription.id,
          providerPaymentId: String(providerPayment.id),
          status: paymentStatus,
          amount,
          currency,
          approvedAt,
        },
        { transaction },
      );
    }
    if (paymentStatus !== "approved" || !approvedAt) return;

    const period = getBillingPeriod(lockedSubscription.startDate, approvedAt);
    const monthStart = new Date(`${period.approvedDate.slice(0, 7)}-01T00:00:00.000Z`);
    const nextMonthStart = new Date(monthStart);
    nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);
    const existingPaidCycle = await BillingPayment.findOne({
      where: {
        billingSubscriptionId: lockedSubscription.id,
        status: "approved",
        approvedAt: { [Op.gte]: monthStart, [Op.lt]: nextMonthStart },
      },
      include: [{ model: Membership, required: true }],
      transaction,
    });
    if (existingPaidCycle) {
      await payment.update({ status: "duplicate" }, { transaction });
      return;
    }

    const currentMembership = await Membership.findOne({
      where: { memberId: lockedSubscription.memberId, status: "active" },
      order: [["endDate", "DESC"], ["id", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const startDate =
      currentMembership && currentMembership.endDate >= period.startDate
        ? addDays(currentMembership.endDate, 1)
        : period.startDate;
    if (startDate > period.endDate) {
      await payment.update({ status: "duplicate" }, { transaction });
      return;
    }

    const membership = await Membership.create(
      {
        memberId: lockedSubscription.memberId,
        planId: lockedSubscription.planId,
        startDate,
        endDate: period.endDate,
      },
      { transaction },
    );
    await payment.update({ membershipId: membership.id }, { transaction });
    await Member.update(
      { status: "active" },
      { where: { id: lockedSubscription.memberId }, transaction },
    );
    await RegistrationRequest.update(
      { status: "reviewed" },
      { where: { memberId: lockedSubscription.memberId, status: "pending" }, transaction },
    );
  });
}

async function createBillingSubscriptionRecord({ memberId, planId }) {
  const today = getArgentinaDate();
  return sequelize.transaction(async (transaction) => {
    const [member, plan] = await Promise.all([
      Member.findByPk(memberId, { transaction }),
      Plan.findOne({ where: { id: planId, isActive: true }, transaction }),
    ]);
    if (!member) return { notFound: "No se encontró el socio." };
    if (!plan) return { notFound: "No se encontró un plan activo." };
    if (plan.durationDays !== 30) {
      return { invalidPlan: "El cobro recurrente solo está disponible para planes mensuales de 30 días." };
    }
    if (Number(plan.price) <= 0) return { invalidPlan: "El cobro recurrente requiere un plan con precio mayor a cero." };
    if (member.status !== "active") {
      return { conflict: "Reactiva al socio antes de activar el cobro mensual." };
    }

    const currentMembership = await Membership.findOne({
      where: {
        memberId: member.id,
        status: "active",
        endDate: { [Op.gte]: today },
      },
      transaction,
    });
    if (currentMembership) {
      return {
        conflict: "El socio tiene una membresía pagada vigente. Activa el cobro recurrente cuando venza para evitar cobrar dos veces.",
      };
    }

    const existingSubscription = await BillingSubscription.findOne({
      where: {
        memberId: member.id,
        status: { [Op.in]: ["creating", "pending", "authorized", "paused"] },
      },
      transaction,
    });
    if (existingSubscription) {
      return { conflict: "El socio ya tiene una suscripción recurrente activa o pendiente." };
    }

    const subscription = await BillingSubscription.create(
      {
        memberId: member.id,
        planId: plan.id,
        externalReference: randomUUID(),
        monthlyAmount: plan.price,
        currency: "ARS",
        billingDay: 1,
        startDate: today,
      },
      { transaction },
    );
    return { member, plan, subscription };
  });
}

async function createAuthorizationForSubscription(subscription, member, plan, backUrl) {
  const authorization = await createSubscriptionAuthorization({
    subscription,
    member,
    plan,
    backUrl,
  });
  const initPoint = new URL(authorization.initPoint);
  const validHosts = ["mercadopago.com", "mercadopago.com.ar"];
  if (
    initPoint.protocol !== "https:" ||
    !validHosts.some((host) => initPoint.hostname === host || initPoint.hostname.endsWith(`.${host}`))
  ) {
    throw new Error("Mercado Pago devolvió una dirección de autorización no válida.");
  }

  await subscription.update({
    providerSubscriptionId: authorization.providerSubscriptionId,
    initPoint: initPoint.toString(),
    status: authorization.status,
    nextPaymentDate: authorization.nextPaymentDate,
  });
  return subscription.initPoint;
}

async function respondWithAuthorization(res, subscription, member, plan, backUrl) {
  try {
    const initPoint = await createAuthorizationForSubscription(subscription, member, plan, backUrl);
    return res.status(201).json({
      subscription,
      initPoint,
      proratedFirstPayment: true,
      billingDay: subscription.billingDay,
    });
  } catch (error) {
    await subscription.update({ status: "setup_failed" });
    return res.status(502).json({
      error: `No se pudo crear la suscripción en Mercado Pago. ${error.message}`,
      subscriptionId: subscription.id,
    });
  }
}

function matchesSecret(provided, expected) {
  const actual = Buffer.from(provided);
  const configured = Buffer.from(expected);
  return actual.length === configured.length && timingSafeEqual(actual, configured);
}

function requestOriginAllowed(req) {
  const origin = req.get("origin");
  if (!origin) return false;
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedOrigins.includes(origin);
}

function setLoginAttempt(key, attempts) {
  if (attempts.count >= maxLoginAttempts) {
    attempts.blockedUntil = Date.now() + loginWindowMs;
    attempts.count = 0;
  }
  loginAttempts.set(key, attempts);
}

router.post(
  "/login",
  [
    body("email").trim().isEmail(),
    body("password").isString().isLength({ min: 1, max: 200 }),
  ],
  validateRequest,
  (req, res, next) => {
    try {
      if (!requestOriginAllowed(req)) {
        return res.status(403).json({ error: "El origen de la solicitud no está permitido." });
      }

      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword || Buffer.byteLength(adminPassword) < 16) {
        return res.status(503).json({ error: "El acceso del administrador no está configurado." });
      }

      const key = req.ip;
      const attempts = loginAttempts.get(key) ?? { count: 0, blockedUntil: 0 };
      if (attempts.blockedUntil > Date.now()) {
        return res.status(429).json({ error: "Demasiados intentos. Intenta más tarde." });
      }
      if (attempts.blockedUntil) {
        attempts.blockedUntil = 0;
        attempts.count = 0;
      }

      const validCredentials =
        matchesSecret(req.body.email.toLowerCase(), adminEmail.toLowerCase()) &&
        matchesSecret(req.body.password, adminPassword);
      if (!validCredentials) {
        attempts.count += 1;
        setLoginAttempt(key, attempts);
        return res.status(401).json({ error: "Correo o contraseña incorrectos." });
      }

      loginAttempts.delete(key);
      setAdminSession(res, adminEmail);
      return res.json({ email: adminEmail, expiresIn: sessionDurationSeconds });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/session", requireAdminSession, (req, res) => {
  res.json({ email: req.admin.email });
});

router.post("/logout", requireAdminSession, (req, res) => {
  if (!requestOriginAllowed(req)) {
    return res.status(403).json({ error: "El origen de la solicitud no está permitido." });
  }
  clearAdminSession(res);
  return res.status(204).end();
});

router.post("/webhooks/mercadopago", async (req, res, next) => {
  try {
    const dataId = req.body?.data?.id ?? req.query["data.id"];
    if (
      !verifyMercadoPagoWebhook({
        dataId: String(dataId ?? ""),
        requestId: req.get("x-request-id"),
        signature: req.get("x-signature"),
        secret: process.env.MP_WEBHOOK_SECRET,
      })
    ) {
      return res.status(401).json({ error: "La firma del webhook de Mercado Pago no es válida." });
    }

    const eventType = req.body?.type ?? req.query.type ?? req.body?.action;
    if (eventType === "payment") {
      await handleMercadoPagoPaymentNotification(String(dataId));
    } else if (eventType === "subscription_preapproval" || eventType === "preapproval") {
      await handleMercadoPagoSubscriptionNotification(String(dataId));
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    return next(error);
  }
});

router.use(requireAdminSession);
router.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !requestOriginAllowed(req)) {
    return res.status(403).json({ error: "El origen de la solicitud no está permitido." });
  }
  return next();
});

router.post(
  "/notifications/promotional",
  [
    body("title").trim().notEmpty().isLength({ max: 80 }),
    body("body").trim().notEmpty().isLength({ max: 500 }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { title, body: message } = matchedData(req);
      const result = await sendPromotionalPush({
        title,
        body: message,
        data: { type: "promotion" },
      });
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/access-qr/check-in",
  [body("token").isString().matches(/^[A-Za-z0-9_-]{43}$/)],
  validateRequest,
  async (req, res, next) => {
    try {
      const tokenHash = hashAccessPassToken(req.body.token);
      const result = await sequelize.transaction(async (transaction) => {
        const candidate = await AccessPass.findOne({
          where: { tokenHash },
          attributes: ["memberId"],
          transaction,
        });
        if (!candidate) return { status: 404, error: "El QR no es válido o ya fue utilizado." };

        const member = await Member.findByPk(candidate.memberId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!member || member.status !== "active") {
          return { status: 403, error: "El socio no tiene una cuenta activa." };
        }

        const accessPass = await AccessPass.findOne({
          where: { tokenHash, memberId: member.id },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!accessPass || !isAccessPassUsable(accessPass)) {
          return { status: 410, error: "El QR venció o ya fue utilizado. Genera uno nuevo desde la app." };
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
          return { status: 403, error: "El socio no tiene una membresía vigente." };
        }

        const checkedInAt = new Date();
        if (!isAccessPassUsable(accessPass, checkedInAt.getTime())) {
          return { status: 410, error: "El QR venció. Genera uno nuevo desde la app." };
        }

        const openAttendance = await Attendance.findOne({
          where: { memberId: member.id, checkedOutAt: null },
          transaction,
        });
        if (openAttendance) {
          return { status: 409, error: "El socio ya tiene un ingreso abierto." };
        }

        await accessPass.update({ usedAt: checkedInAt }, { transaction });
        const attendance = await Attendance.create(
          { memberId: member.id, checkedInAt },
          { transaction },
        );
        return {
          attendance: {
            id: attendance.id,
            checkedInAt: attendance.checkedInAt,
          },
          member: {
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
          },
        };
      });

      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/billing/status", (req, res) => {
  res.json({
    provider: "mercadopago",
    configured: isMercadoPagoConfigured(),
    environment: getMercadoPagoEnvironment(),
    billingDay: 1,
  });
});

router.get("/registration-requests", async (req, res, next) => {
  try {
    const requests = await RegistrationRequest.findAll({
      where: { status: "pending" },
      include: [
        { model: Member, attributes: ["id", "firstName", "lastName", "email", "dni", "address", "phone", "status", "createdAt"] },
        { model: Plan, attributes: ["id", "name", "price", "durationDays", "isActive"] },
      ],
      order: [["createdAt", "ASC"]],
      limit: 250,
    });
    res.json(requests);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/registration-requests/:id/checkout",
  [param("id").isInt({ min: 1 })],
  validateRequest,
  async (req, res, next) => {
    try {
      if (!isMercadoPagoConfigured()) {
        return res.status(503).json({ error: "Configura las credenciales y el webhook de Mercado Pago antes de generar un enlace de pago." });
      }

      const result = await sequelize.transaction(async (transaction) => {
        const registrationRequest = await RegistrationRequest.findByPk(req.params.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!registrationRequest || registrationRequest.status !== "pending") {
          return { conflict: "No se encontró una solicitud pendiente." };
        }
        const [member, plan, existingSubscription] = await Promise.all([
          Member.findByPk(registrationRequest.memberId, { transaction, lock: transaction.LOCK.UPDATE }),
          Plan.findByPk(registrationRequest.planId, { transaction }),
          BillingSubscription.findOne({
            where: { memberId: registrationRequest.memberId },
            order: [["createdAt", "DESC"]],
            transaction,
          }),
        ]);
        if (!member) return { notFound: "No se encontró el socio de esta solicitud." };
        if (!plan || !plan.isActive) return { invalidPlan: "El plan solicitado ya no está activo." };
        if (plan.durationDays !== 30 || Number(plan.price) <= 0) {
          return { invalidPlan: "El cobro recurrente requiere un plan mensual de 30 días con precio mayor a cero." };
        }
        if (member.status === "active") return { conflict: "El socio ya está activo." };
        if (existingSubscription && !["cancelled", "finished", "setup_failed"].includes(existingSubscription.status)) {
          return { conflict: "Esta solicitud ya tiene un cobro automático pendiente o activo." };
        }

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
        return { subscription, member, plan };
      });

      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.invalidPlan) return res.status(400).json({ error: result.invalidPlan });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      return respondWithAuthorization(res, result.subscription, result.member, result.plan);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/registration-requests/:id/approve",
  [
    param("id").isInt({ min: 1 }),
    body("startDate").optional().isISO8601({ strict: true, strictSeparator: true }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const registrationRequest = await RegistrationRequest.findByPk(req.params.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!registrationRequest) return { notFound: "No se encontró la solicitud." };
        if (registrationRequest.status !== "pending") {
          return { conflict: "Esta solicitud ya fue procesada." };
        }

        const [member, plan] = await Promise.all([
          Member.findByPk(registrationRequest.memberId, { transaction, lock: transaction.LOCK.UPDATE }),
          Plan.findByPk(registrationRequest.planId, { transaction }),
        ]);
        if (!member) return { notFound: "No se encontró el socio de esta solicitud." };
        if (!plan || !plan.isActive) return { invalidPlan: "El plan solicitado ya no está activo." };
        if (member.status === "active") return { conflict: "El socio ya está activo." };
        const existingSubscription = await BillingSubscription.findOne({
          where: {
            memberId: member.id,
            status: { [Op.in]: ["creating", "pending", "authorized", "paused"] },
          },
          transaction,
        });
        if (existingSubscription) {
          return { conflict: "Esta solicitud ya tiene un cobro automático pendiente. No confirmes un alta manual." };
        }

        const startDate = req.body.startDate ?? getArgentinaDate();
        const membership = await Membership.create(
          {
            memberId: member.id,
            planId: plan.id,
            startDate,
            endDate: membershipEndDate(startDate, plan.durationDays),
          },
          { transaction },
        );
        await member.update({ status: "active" }, { transaction });
        await registrationRequest.update({ status: "reviewed" }, { transaction });
        return { member, membership };
      });

      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.invalidPlan) return res.status(409).json({ error: result.invalidPlan });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/dashboard", async (req, res, next) => {
  try {
    const now = new Date();
    const today = getArgentinaDate(now);
    const nextWeek = addDays(today, 7);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00-03:00`);
    const todayStart = new Date(`${today}T00:00:00-03:00`);
    const tomorrowStart = new Date(`${addDays(today, 1)}T00:00:00-03:00`);

    const [
      totalMembers,
      activeMembers,
      newMembersThisMonth,
      activeMemberships,
      expiringMemberships,
      attendanceToday,
      expiringMembershipList,
      recentMembers,
    ] = await Promise.all([
        Member.count(),
        Member.count({ where: { status: "active" } }),
        Member.count({ where: { createdAt: { [Op.gte]: monthStart } } }),
        Membership.findAll({
          where: {
            status: "active",
            startDate: { [Op.lte]: today },
            endDate: { [Op.gte]: today },
          },
          include: [{ model: Plan, attributes: ["price", "durationDays"] }],
        }),
        Membership.count({
          where: {
            status: "active",
            startDate: { [Op.lte]: today },
            endDate: { [Op.gte]: today, [Op.lte]: nextWeek },
          },
        }),
        Attendance.count({
          where: { checkedInAt: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } },
        }),
        Membership.findAll({
          where: {
            status: "active",
            startDate: { [Op.lte]: today },
            endDate: { [Op.gte]: today, [Op.lte]: nextWeek },
          },
          include: [
            { model: Member, attributes: ["id", "firstName", "lastName", "email", "phone", "status"] },
            { model: Plan, attributes: ["id", "name", "price"] },
          ],
          order: [["endDate", "ASC"]],
          limit: 8,
        }),
        Member.findAll({
          include: [
            {
              model: RegistrationRequest,
              separate: true,
              order: [["createdAt", "DESC"]],
              limit: 1,
              include: [{ model: Plan, attributes: ["id", "name", "price", "durationDays"] }],
            },
            {
              model: Membership,
              include: [{ model: Plan, attributes: ["id", "name", "price"] }],
            },
            {
              model: BillingSubscription,
              attributes: billingSubscriptionAttributes,
              separate: true,
              order: [["createdAt", "DESC"]],
              limit: 3,
              include: [
                { model: Plan, attributes: ["id", "name", "durationDays", "price"] },
                {
                  model: BillingPayment,
                  attributes: ["status", "amount", "currency", "approvedAt", "createdAt"],
                  separate: true,
                  order: [["createdAt", "DESC"]],
                  limit: 5,
                },
              ],
            },
          ],
          order: [["createdAt", "DESC"]],
          limit: 8,
        }),
      ]);

    const estimatedMonthlyIncome = activeMemberships.reduce(
      (total, membership) =>
        total + (Number(membership.Plan.price) * 30) / membership.Plan.durationDays,
      0,
    );

    res.json({
      totalMembers,
      activeMembers,
      inactiveMembers: totalMembers - activeMembers,
      newMembersThisMonth,
      activeMemberships: activeMemberships.length,
      expiringMemberships,
      expiringMembershipList,
      attendanceToday,
      estimatedMonthlyIncome: Math.round(estimatedMonthlyIncome * 100) / 100,
      recentMembers,
      revenueNote: "Estimación mensual de membresías vigentes; no representa cobros registrados.",
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/members",
  [query("search").optional().isString().trim().isLength({ max: 100 })],
  validateRequest,
  async (req, res, next) => {
    try {
      const search = req.query.search;
      const where = search
        ? {
            [Op.or]: [
              { firstName: { [Op.iLike]: `%${search}%` } },
              { lastName: { [Op.iLike]: `%${search}%` } },
              { email: { [Op.iLike]: `%${search}%` } },
              { phone: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {};
      const members = await Member.findAll({
        where,
        include: [
          {
            model: RegistrationRequest,
            separate: true,
            order: [["createdAt", "DESC"]],
            limit: 1,
            include: [{ model: Plan, attributes: ["id", "name", "price", "durationDays"] }],
          },
          {
            model: Membership,
            include: [{ model: Plan, attributes: ["id", "name", "price"] }],
          },
          {
            model: BillingSubscription,
            attributes: billingSubscriptionAttributes,
            separate: true,
            order: [["createdAt", "DESC"]],
            limit: 3,
            include: [
              { model: Plan, attributes: ["id", "name", "durationDays", "price"] },
              {
                model: BillingPayment,
                attributes: ["status", "amount", "currency", "approvedAt", "createdAt"],
                separate: true,
                order: [["createdAt", "DESC"]],
                limit: 5,
              },
            ],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: 250,
      });
      res.json(members);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/members",
  [
    body("firstName").trim().notEmpty().isLength({ max: 80 }),
    body("lastName").trim().notEmpty().isLength({ max: 80 }),
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
    body("dni").trim().matches(/^\d{7,8}$/),
    body("address").trim().notEmpty().isLength({ max: 200 }),
    body("phone").optional({ nullable: true }).isString().isLength({ max: 30 }),
    body("planId").isInt({ min: 1 }),
    body("startDate").optional().isISO8601({ strict: true, strictSeparator: true }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const result = await sequelize.transaction(async (transaction) => {
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
            dni: req.body.dni,
            address: req.body.address,
            phone: req.body.phone || null,
          },
          { transaction },
        );
        const startDate = req.body.startDate ?? new Date().toISOString().slice(0, 10);
        const membership = await Membership.create(
          {
            memberId: member.id,
            planId: plan.id,
            startDate,
            endDate: membershipEndDate(startDate, plan.durationDays),
          },
          { transaction },
        );

        return { member, membership };
      });

      if (!result) return res.status(404).json({ error: "No se encontró un plan activo." });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/members/auto-billing",
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
      if (!isMercadoPagoConfigured()) {
        return res.status(503).json({ error: "Configura MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET antes de activar los cobros automáticos." });
      }

      const result = await createMemberWithBilling(req.body);
      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.invalidPlan) return res.status(400).json({ error: result.invalidPlan });
      return respondWithAuthorization(res, result.subscription, result.member, result.plan);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/members/:id/auto-billing",
  [param("id").isInt({ min: 1 }), body("planId").isInt({ min: 1 })],
  validateRequest,
  async (req, res, next) => {
    try {
      if (!isMercadoPagoConfigured()) {
        return res.status(503).json({ error: "Configura MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET antes de activar los cobros automáticos." });
      }

      const result = await createBillingSubscriptionRecord({
        memberId: Number(req.params.id),
        planId: Number(req.body.planId),
      });
      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.invalidPlan) return res.status(400).json({ error: result.invalidPlan });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      return respondWithAuthorization(res, result.subscription, result.member, result.plan);
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/members/:id/status",
  [param("id").isInt({ min: 1 }), body("status").isIn(["active", "inactive"])],
  validateRequest,
  async (req, res, next) => {
    try {
      const member = await Member.findByPk(req.params.id);
      if (!member) return res.status(404).json({ error: "No se encontró el socio." });
      if (req.body.status === "inactive") {
        const billingSubscription = await BillingSubscription.findOne({
          where: {
            memberId: member.id,
            status: { [Op.in]: ["creating", "pending", "authorized", "paused"] },
          },
        });
        if (billingSubscription) {
          return res.status(409).json({
            error: "Cancela primero el cobro automático para desactivar al socio y evitar futuros cargos.",
          });
        }
      }
      await member.update({ status: req.body.status });
      res.json(member);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/members/:id/memberships",
  [
    param("id").isInt({ min: 1 }),
    body("planId").isInt({ min: 1 }),
    body("startDate").optional().isISO8601({ strict: true, strictSeparator: true }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [member, plan] = await Promise.all([
          Member.findByPk(req.params.id, { transaction }),
          Plan.findOne({ where: { id: req.body.planId, isActive: true }, transaction }),
        ]);
        if (!member) return { notFound: "No se encontró el socio." };
        if (!plan) return { notFound: "No se encontró un plan activo." };

        const activeBillingSubscription = await BillingSubscription.findOne({
          where: {
            memberId: member.id,
            status: { [Op.in]: ["creating", "pending", "authorized", "paused"] },
          },
          transaction,
        });
        if (activeBillingSubscription) {
          return { billingConflict: "Cancela primero el cobro automático antes de asignar una membresía manual." };
        }

        const today = new Date().toISOString().slice(0, 10);
        const latestActiveMembership = await Membership.findOne({
          where: {
            memberId: member.id,
            status: "active",
            endDate: { [Op.gte]: today },
          },
          order: [["endDate", "DESC"], ["id", "DESC"]],
          transaction,
        });
        const startDate =
          req.body.startDate ??
          (latestActiveMembership ? addDays(latestActiveMembership.endDate, 1) : today);

        if (latestActiveMembership && startDate <= latestActiveMembership.endDate) {
          return { conflict: latestActiveMembership.endDate };
        }

        const membership = await Membership.create(
          {
            memberId: member.id,
            planId: plan.id,
            startDate,
            endDate: membershipEndDate(startDate, plan.durationDays),
          },
          { transaction },
        );
        return { membership };
      });

      if (result.notFound) return res.status(404).json({ error: result.notFound });
      if (result.billingConflict) return res.status(409).json({ error: result.billingConflict });
      if (result.conflict) {
        return res.status(409).json({
          error: `La nueva membresía debe comenzar después del ${result.conflict}.`,
        });
      }
      return res.status(201).json(result.membership);
    } catch (error) {
      return next(error);
    }
  },
);

router.post("/subscriptions/:id/cancel", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const subscription = await BillingSubscription.findByPk(req.params.id);
    if (!subscription) return res.status(404).json({ error: "No se encontró la suscripción." });
    if (subscription.status === "cancelled" || subscription.status === "finished") {
      return res.status(409).json({ error: "La suscripción ya está cancelada o finalizada." });
    }
    if (!subscription.providerSubscriptionId) {
      if (!["setup_failed", "creating"].includes(subscription.status)) {
        return res.status(409).json({ error: "La suscripción todavía no tiene una autorización de Mercado Pago." });
      }
      await subscription.update({ status: "cancelled", cancelledAt: new Date() });
      return res.json(subscription);
    }

    try {
      await cancelMercadoPagoSubscription(subscription.providerSubscriptionId);
    } catch (error) {
      return res.status(502).json({ error: `No se pudo cancelar la suscripción en Mercado Pago. ${error.message}` });
    }
    await subscription.update({ status: "cancelled", cancelledAt: new Date() });
    return res.json(subscription);
  } catch (error) {
    return next(error);
  }
});

router.post("/subscriptions/:id/authorization", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    if (!isMercadoPagoConfigured()) {
      return res.status(503).json({ error: "Configura MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET antes de activar los cobros automáticos." });
    }

    const subscription = await BillingSubscription.findByPk(req.params.id, {
      include: [{ model: Member }, { model: Plan }],
    });
    if (!subscription) return res.status(404).json({ error: "No se encontró la suscripción." });
    if (subscription.status !== "setup_failed" || subscription.providerSubscriptionId) {
      return res.status(409).json({ error: "Esta suscripción no está pendiente de reintentar la autorización." });
    }
    if (subscription.Member.status !== "active" || !subscription.Plan.isActive) {
      return res.status(409).json({ error: "Reactiva al socio y el plan antes de reintentar la autorización." });
    }
    return respondWithAuthorization(res, subscription, subscription.Member, subscription.Plan);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/memberships/:id/status",
  [param("id").isInt({ min: 1 }), body("status").isIn(["active", "cancelled", "expired"])],
  validateRequest,
  async (req, res, next) => {
    try {
      const membership = await Membership.findByPk(req.params.id);
      if (!membership) return res.status(404).json({ error: "No se encontró la membresía." });
      if (req.body.status !== "active") {
        const billingSubscription = await BillingSubscription.findOne({
          where: {
            memberId: membership.memberId,
            status: { [Op.in]: ["creating", "pending", "authorized", "paused"] },
          },
        });
        if (billingSubscription) {
          return res.status(409).json({
            error: "Cancela primero el cobro automático para modificar la membresía y evitar futuros cargos.",
          });
        }
      }
      await membership.update({ status: req.body.status });
      res.json(membership);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/plans", async (req, res, next) => {
  try {
    const plans = await Plan.findAll({ order: [["id", "ASC"]] });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

const planFields = [
  body("name").trim().notEmpty().isLength({ max: 100 }),
  body("description").optional({ nullable: true }).isString(),
  body("durationDays").isInt({ min: 1 }),
  body("price").isFloat({ min: 0 }),
  body("isActive").optional().isBoolean(),
];

router.post("/", planFields, validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.create(matchedData(req, { locations: ["body"] }));
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

router.put("/plans/:id", [param("id").isInt({ min: 1 }), ...planFields], validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: "No se encontró el plan." });
    await plan.update(matchedData(req, { locations: ["body"] }));
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/plans/:id/status",
  [param("id").isInt({ min: 1 }), body("isActive").isBoolean()],
  validateRequest,
  async (req, res, next) => {
    try {
      const plan = await Plan.findByPk(req.params.id);
      if (!plan) return res.status(404).json({ error: "No se encontró el plan." });
      await plan.update({ isActive: req.body.isActive });
      res.json(plan);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/recipes", async (req, res, next) => {
  try {
    const recipes = await Recipe.findAll({ order: [["createdAt", "DESC"], ["id", "DESC"]], limit: 200 });
    res.json(recipes);
  } catch (error) {
    next(error);
  }
});

router.post("/recipes", recipeFields, validateRequest, async (req, res, next) => {
  try {
    const recipe = await Recipe.create(buildRecipeValues(req.body));
    res.status(201).json(recipe);
  } catch (error) {
    next(error);
  }
});

router.put(
  "/recipes/:id",
  [param("id").isInt({ min: 1 }), ...recipeFields],
  validateRequest,
  async (req, res, next) => {
    try {
      const recipe = await Recipe.findByPk(req.params.id);
      if (!recipe) return res.status(404).json({ error: "No se encontró la receta." });
      await recipe.update(buildRecipeValues(req.body));
      return res.json(recipe);
    } catch (error) {
      return next(error);
    }
  },
);

router.delete("/recipes/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const deleted = await Recipe.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ error: "No se encontró la receta." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/community/reports",
  [query("status").optional().isIn(["open", "reviewed", "resolved"])],
  validateRequest,
  async (req, res, next) => {
    try {
      const reports = await CommunityReport.findAll({
        where: req.query.status ? { status: req.query.status } : {},
        include: [
          { model: Member, as: "reporter", attributes: ["firstName", "lastName"] },
          { model: Member, as: "reportedMember", attributes: ["firstName", "lastName"] },
        ],
        order: [["createdAt", "DESC"]],
        limit: 100,
      });
      return res.json(reports);
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/community/reports/:id/status",
  [param("id").isInt({ min: 1 }), body("status").isIn(["open", "reviewed", "resolved"])],
  validateRequest,
  async (req, res, next) => {
    try {
      const report = await CommunityReport.findByPk(req.params.id);
      if (!report) return res.status(404).json({ error: "No se encontró la denuncia." });
      await report.update({ status: req.body.status });
      return res.json({ id: report.id, status: report.status });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
