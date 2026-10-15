import { createHash } from "node:crypto";

const attemptsByIp = new Map();
const attemptsByEmail = new Map();
const windowMs = 60 * 60 * 1000;
const maxAttemptsPerIp = 10;
const maxAttemptsPerEmail = 2;

function cleanExpiredAttempts(attempts, now) {
  for (const [key, entry] of attempts) {
    if (entry.expiresAt <= now) {
      attempts.delete(key);
    }
  }
}

function getRetryAfter(attempts, key, maxAttempts, now) {
  const entry = attempts.get(key);
  if (entry?.expiresAt > now && entry.count >= maxAttempts) {
    return Math.ceil((entry.expiresAt - now) / 1000);
  }
  return 0;
}

function recordAttempt(attempts, key, now) {
  const entry = attempts.get(key);
  if (entry?.expiresAt > now) {
    entry.count += 1;
    return entry;
  }

  const nextEntry = { count: 1, expiresAt: now + windowMs };
  attempts.set(key, nextEntry);
  return nextEntry;
}

export function registrationRateLimit(req, res, next) {
  const email = req.body?.email;
  if (typeof email !== "string") {
    return res.status(400).json({ error: "La dirección de correo no es válida." });
  }

  const now = Date.now();
  cleanExpiredAttempts(attemptsByIp, now);
  cleanExpiredAttempts(attemptsByEmail, now);

  const ip = req.ip || "unknown";
  const emailKey = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  const retryAfter = Math.max(
    getRetryAfter(attemptsByIp, ip, maxAttemptsPerIp, now),
    getRetryAfter(attemptsByEmail, emailKey, maxAttemptsPerEmail, now),
  );

  if (retryAfter > 0) {
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "No se pudo procesar la solicitud en este momento. Intenta nuevamente más tarde.",
    });
  }

  recordAttempt(attemptsByIp, ip, now);
  recordAttempt(attemptsByEmail, emailKey, now);
  return next();
}
