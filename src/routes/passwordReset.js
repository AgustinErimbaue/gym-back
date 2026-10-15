import { Router } from "express";
import { Op } from "sequelize";
import { body } from "express-validator";
import { Member, PasswordResetCode } from "../models/index.js";
import { validateRequest } from "../middleware/validate.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { hashPassword } from "../services/memberAuth.js";
import {
  createPasswordResetCode,
  hashPasswordResetCode,
  passwordResetCodeMatches,
  passwordResetLifetimeMs,
  passwordResetMaxAttempts,
} from "../services/passwordReset.js";
import {
  isEmailConfigured,
  isReservedEmailAddress,
  sendPasswordResetEmail,
} from "../services/welcomeEmail.js";

const router = Router();
const requestLimit = createRateLimit({ maxPerIp: 20, maxPerEmail: 3 });
const confirmLimit = createRateLimit({ maxPerIp: 30, maxPerEmail: 0 });
const genericMessage =
  "Si el correo pertenece a una cuenta, te enviamos un código para crear una nueva contraseña.";
const invalidCodeMessage = "El código no es válido o venció. Solicita uno nuevo.";

router.post(
  "/request",
  [body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 })],
  validateRequest,
  requestLimit,
  async (req, res, next) => {
    try {
      const member = await Member.unscoped().findOne({
        where: { email: req.body.email, passwordHash: { [Op.ne]: null } },
        attributes: ["id", "firstName", "email"],
      });
      if (member) {
        const code = createPasswordResetCode();
        await PasswordResetCode.destroy({ where: { memberId: member.id } });
        await PasswordResetCode.create({
          memberId: member.id,
          codeHash: hashPasswordResetCode(member.id, code),
          expiresAt: new Date(Date.now() + passwordResetLifetimeMs),
        });

        if (!isReservedEmailAddress(member.email) && isEmailConfigured()) {
          try {
            await sendPasswordResetEmail({ member, code });
          } catch (emailError) {
            console.error("No se pudo enviar el código de recuperación:", emailError.code ?? emailError.name);
          }
        } else if (process.env.NODE_ENV !== "production") {
          console.log(`[recuperación] Código para ${member.email}: ${code}`);
        }
      }
      return res.json({ message: genericMessage });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/confirm",
  [
    body("email").trim().isEmail().normalizeEmail().isLength({ max: 254 }),
    body("code").isString().matches(/^\d{6}$/),
    body("password").isString().isLength({ min: 8, max: 128 }),
  ],
  validateRequest,
  confirmLimit,
  async (req, res, next) => {
    try {
      const member = await Member.unscoped().findOne({
        where: { email: req.body.email },
        attributes: ["id"],
      });
      const reset = member
        ? await PasswordResetCode.findOne({
            where: { memberId: member.id, expiresAt: { [Op.gt]: new Date() } },
            order: [["id", "DESC"]],
          })
        : null;
      if (!member || !reset || reset.attempts >= passwordResetMaxAttempts) {
        return res.status(400).json({ error: invalidCodeMessage });
      }

      if (!passwordResetCodeMatches(member.id, req.body.code, reset.codeHash)) {
        await reset.increment("attempts");
        return res.status(400).json({ error: invalidCodeMessage });
      }

      await Member.unscoped().update(
        { passwordHash: await hashPassword(req.body.password) },
        { where: { id: member.id } },
      );
      await PasswordResetCode.destroy({ where: { memberId: member.id } });
      return res.json({ message: "Tu contraseña se actualizó. Ya puedes iniciar sesión." });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
