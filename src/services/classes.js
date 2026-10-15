import { body } from "express-validator";

export const classFields = [
  body("name").trim().notEmpty().isLength({ max: 80 }),
  body("description").optional().trim().isLength({ max: 400 }),
  body("instructor").optional().trim().isLength({ max: 80 }),
  body("startsAt").isISO8601({ strict: true }),
  body("durationMinutes").isInt({ min: 15, max: 240 }),
  body("capacity").isInt({ min: 1, max: 200 }),
];

export function buildClassValues(input) {
  return {
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    instructor: (input.instructor ?? "").trim(),
    startsAt: new Date(input.startsAt),
    durationMinutes: Number(input.durationMinutes),
    capacity: Number(input.capacity),
  };
}

export function serializeClass(gymClass, { booked = 0, isBooked = false } = {}) {
  return {
    id: gymClass.id,
    name: gymClass.name,
    description: gymClass.description,
    instructor: gymClass.instructor,
    startsAt: gymClass.startsAt,
    durationMinutes: gymClass.durationMinutes,
    capacity: gymClass.capacity,
    booked,
    isBooked,
    isCancelled: gymClass.isCancelled,
  };
}

export async function countBookings(ClassBooking, classIds) {
  if (!classIds.length) return new Map();
  const rows = await ClassBooking.findAll({
    where: { classId: classIds },
    attributes: ["classId"],
    raw: true,
  });
  const counts = new Map();
  for (const { classId } of rows) counts.set(classId, (counts.get(classId) ?? 0) + 1);
  return counts;
}
