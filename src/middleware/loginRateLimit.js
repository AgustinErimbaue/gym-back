const attemptsByIp = new Map();
const windowMs = 15 * 60 * 1000;
const maxAttempts = 8;

export function loginRateLimit(req, res, next) {
  const now = Date.now();
  for (const [ip, entry] of attemptsByIp) {
    if (entry.expiresAt <= now) {
      attemptsByIp.delete(ip);
    }
  }

  const ip = req.ip;
  const entry = attemptsByIp.get(ip);
  if (entry?.blockedUntil > now) {
    res.set("Retry-After", String(Math.ceil((entry.blockedUntil - now) / 1000)));
    return res.status(429).json({ error: "Demasiados intentos. Intenta nuevamente más tarde." });
  }

  const current = entry?.expiresAt > now ? entry : { count: 0, expiresAt: now + windowMs, blockedUntil: 0 };
  current.count += 1;
  if (current.count >= maxAttempts) {
    current.blockedUntil = now + windowMs;
  }
  attemptsByIp.set(ip, current);

  req.clearMemberLoginAttempts = () => attemptsByIp.delete(ip);
  return next();
}
