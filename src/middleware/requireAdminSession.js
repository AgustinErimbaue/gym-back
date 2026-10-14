import { createHmac, timingSafeEqual } from "node:crypto";

const cookieName = "gym_admin_session";
const sessionDurationSeconds = 8 * 60 * 60;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("ADMIN_SESSION_SECRET debe tener al menos 32 bytes.");
  }
  return secret;
}

function signature(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function createAdminSession(email) {
  const payload = Buffer.from(
    JSON.stringify({ email, expiresAt: Math.floor(Date.now() / 1000) + sessionDurationSeconds }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function clearAdminSession(res) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin",
  });
}

export function setAdminSession(res, email) {
  res.cookie(cookieName, createAdminSession(email), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionDurationSeconds * 1000,
    path: "/api/admin",
  });
}

export function requireAdminSession(req, res, next) {
  try {
    const cookies = (req.get("cookie") ?? "").split(";").map((cookie) => cookie.trim());
    const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
    const token = sessionCookie?.slice(cookieName.length + 1);
    if (!token) {
      return res.status(401).json({ error: "Inicia sesión para acceder al panel del gimnasio." });
    }

    const [payload, providedSignature, extra] = token.split(".");
    if (!payload || !providedSignature || extra !== undefined) {
      return res.status(401).json({ error: "La sesión no es válida." });
    }

    const expectedSignature = Buffer.from(signature(payload));
    const actualSignature = Buffer.from(providedSignature);
    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return res.status(401).json({ error: "La sesión no es válida." });
    }

    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof session.email !== "string" ||
      session.email !== process.env.ADMIN_EMAIL ||
      !Number.isInteger(session.expiresAt) ||
      session.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return res.status(401).json({ error: "La sesión venció. Inicia sesión nuevamente." });
    }

    req.admin = { email: session.email };
    return next();
  } catch (error) {
    return next(error);
  }
}

export { sessionDurationSeconds };
