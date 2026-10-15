import { verifyMemberSession } from "../services/memberAuth.js";

export function requireMemberSession(req, res, next) {
  const authorization = req.get("authorization") ?? "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  const session = match ? verifyMemberSession(match[1]) : null;

  if (!session) {
    return res.status(401).json({ error: "Tu sesión no es válida o venció. Inicia sesión nuevamente." });
  }

  req.member = { id: session.memberId };
  return next();
}
