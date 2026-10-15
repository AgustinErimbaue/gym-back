import { Router } from "express";
import { Op } from "sequelize";
import { param } from "express-validator";
import { ClassBooking, GymClass, Member, Membership, sequelize } from "../models/index.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { validateRequest } from "../middleware/validate.js";
import { getArgentinaDate } from "../services/mercadoPago.js";
import { countBookings, serializeClass } from "../services/classes.js";

const router = Router();
const upcomingDays = 14;

router.use(requireMemberSession);

router.get("/", async (req, res, next) => {
  try {
    const now = new Date();
    const classes = await GymClass.findAll({
      where: {
        startsAt: { [Op.gte]: now, [Op.lte]: new Date(now.getTime() + upcomingDays * 86400000) },
      },
      order: [["startsAt", "ASC"], ["id", "ASC"]],
      limit: 200,
    });
    const ids = classes.map(({ id }) => id);
    const [counts, mine] = await Promise.all([
      countBookings(ClassBooking, ids),
      ids.length
        ? ClassBooking.findAll({
            where: { memberId: req.member.id, classId: ids },
            attributes: ["classId"],
            raw: true,
          })
        : [],
    ]);
    const bookedIds = new Set(mine.map(({ classId }) => classId));
    return res.json({
      classes: classes.map((gymClass) =>
        serializeClass(gymClass, {
          booked: counts.get(gymClass.id) ?? 0,
          isBooked: bookedIds.has(gymClass.id),
        }),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:id/book",
  [param("id").isInt({ min: 1 }).toInt()],
  validateRequest,
  async (req, res, next) => {
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        const member = await Member.findByPk(req.member.id, { attributes: ["id", "status"], transaction });
        const today = getArgentinaDate();
        const membership = member?.status === "active"
          ? await Membership.findOne({
              where: {
                memberId: member.id,
                status: "active",
                startDate: { [Op.lte]: today },
                endDate: { [Op.gte]: today },
              },
              attributes: ["id"],
              transaction,
            })
          : null;
        if (!membership) {
          return { status: 403, error: "Necesitas una membresía vigente para reservar clases." };
        }

        const gymClass = await GymClass.findByPk(req.params.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!gymClass) return { status: 404, error: "No se encontró la clase." };
        if (gymClass.isCancelled) return { status: 409, error: "Esta clase fue cancelada." };
        if (gymClass.startsAt <= new Date()) return { status: 409, error: "Esta clase ya comenzó." };

        const existing = await ClassBooking.findOne({
          where: { classId: gymClass.id, memberId: member.id },
          transaction,
        });
        if (existing) return { status: 409, error: "Ya reservaste esta clase." };

        const booked = await ClassBooking.count({ where: { classId: gymClass.id }, transaction });
        if (booked >= gymClass.capacity) return { status: 409, error: "La clase no tiene cupos disponibles." };

        await ClassBooking.create({ classId: gymClass.id, memberId: member.id }, { transaction });
        return { status: 201, gymClass, booked: booked + 1 };
      });

      if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
      return res.status(201).json({
        class: serializeClass(outcome.gymClass, { booked: outcome.booked, isBooked: true }),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:id/book",
  [param("id").isInt({ min: 1 }).toInt()],
  validateRequest,
  async (req, res, next) => {
    try {
      const gymClass = await GymClass.findByPk(req.params.id);
      if (!gymClass) return res.status(404).json({ error: "No se encontró la clase." });
      if (gymClass.startsAt <= new Date()) {
        return res.status(409).json({ error: "Esta clase ya comenzó y no se puede cancelar la reserva." });
      }
      const deleted = await ClassBooking.destroy({
        where: { classId: gymClass.id, memberId: req.member.id },
      });
      if (!deleted) return res.status(404).json({ error: "No tenías una reserva en esta clase." });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
