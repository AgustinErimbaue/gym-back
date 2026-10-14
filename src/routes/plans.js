import { Router } from "express";
import { body, param } from "express-validator";
import { Plan } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();
const planFields = [
  body("name").trim().notEmpty().isLength({ max: 100 }),
  body("description").optional({ nullable: true }).isString(),
  body("durationDays").isInt({ min: 1 }),
  body("price").isFloat({ min: 0 }),
  body("isActive").optional().isBoolean(),
];

router.get("/", async (req, res, next) => {
  try {
    const plans = await Plan.findAll({ order: [["id", "ASC"]] });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: "No se encontró el plan." });
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

router.post("/", planFields, validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", param("id").isInt({ min: 1 }), planFields, validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: "No se encontró el plan." });
    await plan.update(req.body);
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: "No se encontró el plan." });
    await plan.destroy();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
