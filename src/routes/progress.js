import { Router } from "express";
import { body, param } from "express-validator";
import { BodyMeasurement, Workout } from "../models/index.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { validateRequest } from "../middleware/validate.js";
import { getArgentinaDate } from "../services/mercadoPago.js";
import { buildExerciseProgress } from "../services/progress.js";

const router = Router();
const measurementFields = ["bodyFatPercent", "waistCm", "chestCm", "hipsCm", "armCm"];

router.use(requireMemberSession);

function serializeMeasurement(measurement) {
  return {
    id: measurement.id,
    measuredOn: measurement.measuredOn,
    weightKg: Number(measurement.weightKg),
    ...Object.fromEntries(
      measurementFields.map((field) => [
        field,
        measurement[field] === null ? null : Number(measurement[field]),
      ]),
    ),
  };
}

router.get("/", async (req, res, next) => {
  try {
    const [measurements, workouts] = await Promise.all([
      BodyMeasurement.findAll({
        where: { memberId: req.member.id },
        order: [["measuredOn", "DESC"]],
        limit: 60,
      }),
      Workout.findAll({
        where: { memberId: req.member.id },
        attributes: ["exercises", "performedAt"],
        order: [["performedAt", "DESC"]],
        limit: 200,
      }),
    ]);
    return res.json({
      measurements: measurements.map(serializeMeasurement).reverse(),
      exercises: buildExerciseProgress(workouts),
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/measurements",
  [
    body("measuredOn").optional().isISO8601({ strict: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
    body("weightKg").isFloat({ min: 20, max: 400 }),
    body("bodyFatPercent").optional({ values: "null" }).isFloat({ min: 2, max: 70 }),
    body("waistCm").optional({ values: "null" }).isFloat({ min: 30, max: 250 }),
    body("chestCm").optional({ values: "null" }).isFloat({ min: 30, max: 250 }),
    body("hipsCm").optional({ values: "null" }).isFloat({ min: 30, max: 250 }),
    body("armCm").optional({ values: "null" }).isFloat({ min: 10, max: 100 }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const today = getArgentinaDate();
      const measuredOn = req.body.measuredOn ?? today;
      if (measuredOn > today) {
        return res.status(400).json({ error: "La fecha no puede ser futura." });
      }

      const values = {
        memberId: req.member.id,
        measuredOn,
        weightKg: Number(req.body.weightKg),
        ...Object.fromEntries(
          measurementFields.map((field) => [
            field,
            req.body[field] === undefined || req.body[field] === null ? null : Number(req.body[field]),
          ]),
        ),
      };
      await BodyMeasurement.upsert(values, { conflictFields: ["member_id", "measured_on"] });
      const saved = await BodyMeasurement.findOne({
        where: { memberId: req.member.id, measuredOn },
      });
      return res.status(201).json({ measurement: serializeMeasurement(saved) });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/measurements/:id",
  [param("id").isInt({ min: 1 }).toInt()],
  validateRequest,
  async (req, res, next) => {
    try {
      const deleted = await BodyMeasurement.destroy({
        where: { id: req.params.id, memberId: req.member.id },
      });
      if (!deleted) return res.status(404).json({ error: "No se encontró la medición." });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
