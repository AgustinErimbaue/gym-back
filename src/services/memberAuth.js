import { promisify } from "node:util";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const scrypt = promisify(scryptCallback);
const passwordBytes = 64;
const sessionDurationSeconds = 7 * 24 * 60 * 60;
const dummyPasswordHash = `scrypt$0123456789abcdef0123456789abcdef$${"A".repeat(86)}`;

function sessionSecret() {
  const secret = process.env.MEMBER_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("MEMBER_SESSION_SECRET debe tener al menos 32 bytes.");
  }
  return secret;
}

function sign(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scrypt(password, salt, passwordBytes, { maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString("base64url")}`;
}

export async function verifyPassword(password, encodedHash) {
  const [algorithm, salt, encodedKey, extra] = (encodedHash ?? "").split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !encodedKey ||
    extra !== undefined
  ) {
    return false;
  }

  const expectedKey = Buffer.from(encodedKey, "base64url");
  if (expectedKey.length !== passwordBytes) {
    return false;
  }

  const derivedKey = Buffer.from(
    await scrypt(password, salt, passwordBytes, { maxmem: 64 * 1024 * 1024 }),
  );
  return timingSafeEqual(expectedKey, derivedKey);
}

export async function verifyPasswordOrDummy(password, encodedHash) {
  return verifyPassword(password, encodedHash ?? dummyPasswordHash);
}

export function createMemberSession(memberId) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const payload = Buffer.from(JSON.stringify({ memberId, expiresAt })).toString("base64url");
  return { accessToken: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyMemberSession(token) {
  const [payload, providedSignature, extra] = (token ?? "").split(".");
  if (!payload || !providedSignature || extra !== undefined) {
    return null;
  }

  const expectedSignature = Buffer.from(sign(payload));
  const actualSignature = Buffer.from(providedSignature);
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return null;
  }

  let session;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    !Number.isInteger(session.memberId) ||
    session.memberId < 1 ||
    !Number.isInteger(session.expiresAt) ||
    session.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return { memberId: session.memberId, expiresAt: session.expiresAt };
}
