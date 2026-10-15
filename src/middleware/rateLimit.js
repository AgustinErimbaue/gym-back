import { createHash } from "node:crypto";

// Limitador en memoria por IP y por correo, con ventana de una hora.
export function createRateLimit({ maxPerIp, maxPerEmail }) {
  const windowMs = 60 * 60 * 1000;
  const byIp = new Map();
  const byEmail = new Map();

  function hit(map, key, max, now) {
    for (const [storedKey, entry] of map) {
      if (entry.expiresAt <= now) map.delete(storedKey);
    }
    const entry = map.get(key);
    if (!entry) {
      map.set(key, { count: 1, expiresAt: now + windowMs });
      return 0;
    }
    entry.count += 1;
    return entry.count > max ? Math.ceil((entry.expiresAt - now) / 1000) : 0;
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const emailKey = createHash("sha256").update(email).digest("hex");
    const retryAfter = Math.max(
      hit(byIp, req.ip || "unknown", maxPerIp, now),
      maxPerEmail ? hit(byEmail, emailKey, maxPerEmail, now) : 0,
    );
    if (retryAfter > 0) {
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Demasiados intentos. Intenta nuevamente más tarde." });
    }
    return next();
  };
}
