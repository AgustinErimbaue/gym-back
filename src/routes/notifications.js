import { Router } from "express";
import { body } from "express-validator";
import { Member, MemberPushToken } from "../models/index.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();
const maxDevicesPerMember = 5;

router.use(requireMemberSession);

router.put(
  "/push-token",
  [
    body("token").isString().matches(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,240}\]$/),
    body("platform").isIn(["ios", "android"]),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const member = await Member.findByPk(req.member.id, {
        attributes: ["id", "status"],
      });
      if (!member || member.status !== "active") {
        return res.status(403).json({ error: "Las notificaciones están disponibles para socios activos." });
      }

      await MemberPushToken.upsert({
        memberId: member.id,
        token: req.body.token,
        platform: req.body.platform,
      });
      const memberTokens = await MemberPushToken.findAll({
        where: { memberId: member.id },
        attributes: ["id"],
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
      });
      const excessTokens = memberTokens.slice(maxDevicesPerMember);
      if (excessTokens.length) {
        await MemberPushToken.destroy({
          where: { id: excessTokens.map(({ id }) => id) },
        });
      }
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/push-token",
  [body("token").isString().matches(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,240}\]$/)],
  validateRequest,
  async (req, res, next) => {
    try {
      await MemberPushToken.destroy({
        where: { memberId: req.member.id, token: req.body.token },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
