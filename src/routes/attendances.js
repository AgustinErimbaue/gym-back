import { Op } from "sequelize";
import { Router } from "express";
import { body, param, query } from "express-validator";
import { Attendance, Member, Membership } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();

router.get(
  "/",
  [query("memberId").optional().isInt({ min: 1 })],
  validateRequest,
  async (req, res, next) => {
    try {
      const where = req.query.memberId ? { memberId: req.query.memberId } : {};
      const attendances = await Attendance.findAll({
        where,
        include: [{ model: Member }],
        order: [["checkedInAt", "DESC"]],
      });
      res.json(attendances);
    } catch (error) {
      next(error);
    }
  },
);

router.post("/", body("memberId").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.body.memberId);
    if (!member || member.status !== "active") {
      return res.status(404).json({ error: "No se encontró un socio activo." });
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const membership = await Membership.findOne({
      where: {
        memberId: member.id,
        status: "active",
        startDate: { [Op.lte]: today },
        endDate: { [Op.gte]: today },
      },
    });
    if (!membership) {
      return res.status(403).json({ error: "El socio no tiene una membresía vigente." });
    }

    const openAttendance = await Attendance.findOne({
      where: { memberId: member.id, checkedOutAt: null },
    });
    if (openAttendance) {
      return res.status(409).json({ error: "El socio ya tiene una asistencia abierta." });
    }

    const attendance = await Attendance.create({ memberId: member.id });
    res.status(201).json(attendance);
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id/checkout",
  param("id").isInt({ min: 1 }),
  validateRequest,
  async (req, res, next) => {
    try {
      const attendance = await Attendance.findByPk(req.params.id);
      if (!attendance) return res.status(404).json({ error: "No se encontró la asistencia." });
      if (attendance.checkedOutAt) {
        return res.status(409).json({ error: "La asistencia ya está cerrada." });
      }
      await attendance.update({ checkedOutAt: new Date() });
      res.json(attendance);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
