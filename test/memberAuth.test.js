import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemberSession,
  hashPassword,
  verifyMemberSession,
  verifyPassword,
  verifyPasswordOrDummy,
} from "../src/services/memberAuth.js";

test("hashea la contraseña y verifica el hash sin guardar el texto original", async () => {
  const password = "una-clave-segura-123";
  const encodedHash = await hashPassword(password);

  assert.notEqual(encodedHash, password);
  assert.match(encodedHash, /^scrypt\$/);
  assert.equal(await verifyPassword(password, encodedHash), true);
  assert.equal(await verifyPassword("otra-clave-segura", encodedHash), false);
  assert.equal(await verifyPasswordOrDummy(password, undefined), false);
});

test("firma sesiones de socio y rechaza firmas modificadas", () => {
  const previousSecret = process.env.MEMBER_SESSION_SECRET;
  process.env.MEMBER_SESSION_SECRET = "member-session-secret-for-tests-32-bytes";

  try {
    const session = createMemberSession(42);
    assert.deepEqual(verifyMemberSession(session.accessToken), {
      memberId: 42,
      expiresAt: session.expiresAt,
    });
    assert.equal(verifyMemberSession(`${session.accessToken}x`), null);
    assert.equal(verifyMemberSession("invalid"), null);
  } finally {
    if (previousSecret === undefined) delete process.env.MEMBER_SESSION_SECRET;
    else process.env.MEMBER_SESSION_SECRET = previousSecret;
  }
});
