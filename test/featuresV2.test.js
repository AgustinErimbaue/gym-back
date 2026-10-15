import assert from "node:assert/strict";
import test from "node:test";
import { buildExerciseProgress } from "../src/services/progress.js";
import { notifyNewMessage, waitForNewMessage } from "../src/services/messageBus.js";

// Sequelize no se conecta hasta la primera consulta, así que basta una URL de relleno.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { addDaysToDate, argentinaHour, weekKey } = await import("../src/services/reminders.js");

test("buildExerciseProgress resume la mejor marca y el cambio", () => {
  const result = buildExerciseProgress([
    { performedAt: "2026-10-01T10:00:00Z", exercises: [{ name: "Sentadilla", weightKg: 60, reps: 8 }] },
    {
      performedAt: "2026-10-08T10:00:00Z",
      exercises: [
        { name: "sentadilla", weightKg: 70, reps: 5 },
        { name: "sentadilla", weightKg: 65, reps: 8 },
        { name: "", weightKg: 10, reps: 10 },
      ],
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sessions, 2);
  assert.equal(result[0].bestWeightKg, 70);
  assert.equal(result[0].changeKg, 10);
  assert.equal(result[0].points.length, 2);
});

test("addDaysToDate y weekKey trabajan con fechas YYYY-MM-DD", () => {
  assert.equal(addDaysToDate("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysToDate("2026-03-01", -1), "2026-02-28");
  assert.equal(weekKey("2026-10-15"), "2026-10-12");
  assert.equal(weekKey("2026-10-18"), "2026-10-12");
});

test("argentinaHour usa UTC-3", () => {
  assert.equal(argentinaHour(new Date("2026-10-15T15:30:00Z")), 12);
});

test("waitForNewMessage se resuelve al instante con un aviso y por tiempo sin él", async () => {
  const started = Date.now();
  const waiting = waitForNewMessage(501, 5000);
  notifyNewMessage(501);
  await waiting;
  assert.ok(Date.now() - started < 1000);

  const timeoutStarted = Date.now();
  await waitForNewMessage(502, 50);
  assert.ok(Date.now() - timeoutStarted >= 30);
});
