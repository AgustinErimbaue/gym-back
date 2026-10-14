import { Router } from "express";
import { body, param } from "express-validator";
import { Member, Membership, Plan } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const memberships = await Membership.findAll({
      include: [{ model: Member }, { model: Plan }],
      order: [["id", "DESC"]],
    });
    res.json(memberships);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const membership = await Membership.findByPk(req.params.id, {
      include: [{ model: Member }, { model: Plan }],
    });
    if (!membership) return res.status(404).json({ error: "No se encontró la membresía." });
    res.json(membership);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  [
    body("memberId").isInt({ min: 1 }),
    body("planId").isInt({ min: 1 }),
    body("startDate").optional().isISO8601({ strict: true, strictSeparator: true }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const [member, plan] = await Promise.all([
        Member.findByPk(req.body.memberId),
        Plan.findByPk(req.body.planId),
      ]);
      if (!member) return res.status(404).json({ error: "No se encontró el socio." });
      if (!plan || !plan.isActive) return res.status(404).json({ error: "No se encontró un plan activo." });

      const startDate = req.body.startDate ?? new Date().toISOString().slice(0, 10);
      const end = new Date(`${startDate}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + plan.durationDays - 1);
      const endDate = end.toISOString().slice(0, 10);
      const membership = await Membership.create({
        memberId: member.id,
        planId: plan.id,
        startDate,
        endDate,
      });
      res.status(201).json(membership);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:id/status",
  [param("id").isInt({ min: 1 }), body("status").isIn(["active", "cancelled", "expired"])],
  validateRequest,
  async (req, res, next) => {
    try {
      const membership = await Membership.findByPk(req.params.id);
      if (!membership) return res.status(404).json({ error: "No se encontró la membresía." });
      await membership.update({ status: req.body.status });
      res.json(membership);
    } catch (error) {
      next(error);
    }
  },
);

router.delete("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const membership = await Membership.findByPk(req.params.id);
    if (!membership) return res.status(404).json({ error: "No se encontró la membresía." });
    await membership.destroy();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
