import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const passwordResetLifetimeMs = 15 * 60 * 1000;
export const passwordResetMaxAttempts = 5;

export function createPasswordResetCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashPasswordResetCode(memberId, code) {
  const secret = process.env.MEMBER_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("MEMBER_SESSION_SECRET debe tener al menos 32 bytes.");
  }
  return createHmac("sha256", secret).update(`password-reset:${memberId}:${code}`).digest("hex");
}

export function passwordResetCodeMatches(memberId, code, expectedHash) {
  const actual = Buffer.from(hashPasswordResetCode(memberId, code));
  const expected = Buffer.from(expectedHash ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
