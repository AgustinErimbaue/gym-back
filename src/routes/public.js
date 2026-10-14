import { Router } from "express";
import { randomUUID } from "node:crypto";
import { body } from "express-validator";
import { BillingSubscription, Member, Plan, RegistrationRequest, sequelize } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";
import { isEmailConfigured, sendRegistrationReceivedEmail } from "../services/welcomeEmail.js";
import {
  createSubscriptionAuthorization,
  getArgentinaDate,
  isMercadoPagoConfigured,
} from "../services/mercadoPago.js";

const router = Router();

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
      if (!isMercadoPagoConfigured()) {
        return res.status(503).json({
          error: "El pago en línea todavía no está habilitado. Contacta al gimnasio para completar tu inscripción.",
        });
      }
      if (!process.env.GYM_PUBLIC_URL) {
        return res.status(503).json({ error: "El checkout no está disponible porque falta configurar GYM_PUBLIC_URL." });
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
        return res.status(201).json({ initPoint: result.subscription.initPoint });
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
  async (req, res, next) => {
    try {
      if (!isEmailConfigured()) {
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

      try {
        await sendRegistrationReceivedEmail({
          member: registration.member,
          plan: registration.plan,
        });
        return res.status(201).json({
          requestId: registration.registrationRequest.id,
          emailSent: true,
        });
      } catch (emailError) {
        console.error("La solicitud se guardó, pero no se pudo enviar el correo de confirmación:", emailError);
        return res.status(201).json({
          requestId: registration.registrationRequest.id,
          emailSent: false,
          emailWarning: "Tu solicitud se guardó, pero no pudimos enviar el correo. Contacta al gimnasio.",
        });
      }
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
