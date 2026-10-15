import assert from "node:assert/strict";
import test from "node:test";
import {
  accessPassLifetimeSeconds,
  createAccessPassToken,
  hashAccessPassToken,
  isAccessPassUsable,
} from "../src/services/accessPass.js";

test("crea tokens aleatorios de formato QR y almacena solo un hash estable", () => {
  const token = createAccessPassToken();

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(accessPassLifetimeSeconds, 60);
  assert.equal(hashAccessPassToken(token), hashAccessPassToken(token));
  assert.notEqual(hashAccessPassToken(token), token);
  assert.notEqual(createAccessPassToken(), token);
});

test("acepta un QR no usado antes de vencer y rechaza los usados o vencidos", () => {
  const now = Date.now();
  const activePass = { expiresAt: new Date(now + 60_000), usedAt: null };

  assert.equal(isAccessPassUsable(activePass, now), true);
  assert.equal(isAccessPassUsable(activePass, now + 60_000), false);
  assert.equal(isAccessPassUsable({ ...activePass, usedAt: new Date(now) }, now), false);
});
