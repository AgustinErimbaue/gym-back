import { createHash, randomBytes } from "node:crypto";

export const accessPassLifetimeSeconds = 60;

export function createAccessPassToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAccessPassToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function isAccessPassUsable(accessPass, now = Date.now()) {
  return !accessPass.usedAt && accessPass.expiresAt.getTime() > now;
}
