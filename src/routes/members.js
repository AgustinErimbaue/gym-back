import { Router } from "express";
import { body, matchedData, param } from "express-validator";
import { Member } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();
const memberFields = [
  body("firstName").trim().notEmpty().isLength({ max: 80 }),
  body("lastName").trim().notEmpty().isLength({ max: 80 }),
  body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
  body("dni").optional().trim().matches(/^\d{7,8}$/),
  body("address").optional().trim().notEmpty().isLength({ max: 200 }),
  body("phone").optional({ nullable: true }).isString().isLength({ max: 30 }),
  body("status").optional().isIn(["active", "inactive"]),
];

router.get("/", async (req, res, next) => {
  try {
    const members = await Member.findAll({ order: [["id", "ASC"]] });
    res.json(members);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.params.id);
    if (!member) return res.status(404).json({ error: "No se encontró el socio." });
    res.json(member);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  [
    ...memberFields,
    body("dni").trim().matches(/^\d{7,8}$/),
    body("address").trim().notEmpty().isLength({ max: 200 }),
  ],
  validateRequest,
  async (req, res, next) => {
  try {
    const member = await Member.create(matchedData(req, { locations: ["body"] }));
    res.status(201).json(member);
  } catch (error) {
    next(error);
  }
  },
);

router.put("/:id", param("id").isInt({ min: 1 }), memberFields, validateRequest, async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.params.id);
    if (!member) return res.status(404).json({ error: "No se encontró el socio." });
    await member.update(matchedData(req, { locations: ["body"] }));
    res.json(member);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.params.id);
    if (!member) return res.status(404).json({ error: "No se encontró el socio." });
    await member.destroy();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
