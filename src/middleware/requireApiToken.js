import { timingSafeEqual } from "node:crypto";

export function requireApiToken(req, res, next) {
  const expectedToken = process.env.API_TOKEN;
  if (!expectedToken) {
    return res.status(503).json({ error: "La autenticación de la API no está configurada." });
  }

  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return res.status(401).json({ error: "Se requiere un token Bearer válido." });
  }

  const providedToken = Buffer.from(match[1]);
  const configuredToken = Buffer.from(expectedToken);
  if (
    providedToken.length !== configuredToken.length ||
    !timingSafeEqual(providedToken, configuredToken)
  ) {
    return res.status(401).json({ error: "Se requiere un token Bearer válido." });
  }

  return next();
}
