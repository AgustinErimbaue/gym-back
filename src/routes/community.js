import { Op } from "sequelize";
import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  CommunityBlock,
  CommunityConnection,
  CommunityMessage,
  CommunityProfile,
  CommunityReport,
  Member,
} from "../models/index.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { validateRequest } from "../middleware/validate.js";
import { memberPhotoUrl } from "../services/memberProfilePhoto.js";
import { notifyNewMessage, waitForNewMessage } from "../services/messageBus.js";
import { sendPushToMember } from "../services/pushNotifications.js";

const router = Router();
const trainingLevels = ["Principiante", "Intermedio", "Experto"];
const reportReasons = ["inappropriate", "harassment", "fake_profile", "other"];

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function orderedMembers(firstId, secondId) {
  return firstId < secondId
    ? { memberA: firstId, memberB: secondId }
    : { memberA: secondId, memberB: firstId };
}

function profileMemberId(connection, currentMemberId) {
  return connection.memberA === currentMemberId ? connection.memberB : connection.memberA;
}

function publicMember(member, profile) {
  return {
    id: member.id,
    firstName: member.firstName,
    profilePhotoUrl: profile?.isVisible ? memberPhotoUrl(member) : null,
    trainingLevel: profile?.isVisible ? profile.trainingLevel : null,
    goal: profile?.isVisible ? profile.goal : null,
  };
}

async function getPairConnection(firstId, secondId, status = "accepted") {
  return CommunityConnection.findOne({
    where: { ...orderedMembers(firstId, secondId), status },
  });
}

async function isBlocked(firstId, secondId) {
  return Boolean(
    await CommunityBlock.findOne({
      where: {
        [Op.or]: [
          { blockedBy: firstId, blockedMemberId: secondId },
          { blockedBy: secondId, blockedMemberId: firstId },
        ],
      },
    }),
  );
}

router.use(requireMemberSession);
router.use(
  asyncRoute(async (req, res, next) => {
    const member = await Member.findByPk(req.member.id, { attributes: ["id", "status"] });
    if (!member || member.status !== "active") {
      return res.status(403).json({ error: "La comunidad está disponible para socios activos." });
    }
    return next();
  }),
);

router.get(
  "/profile",
  asyncRoute(async (req, res) => {
    const profile = await CommunityProfile.findByPk(req.member.id);
    return res.json({
      isVisible: profile?.isVisible ?? false,
      trainingLevel: profile?.trainingLevel ?? null,
      goal: profile?.goal ?? "",
    });
  }),
);

router.put(
  "/profile",
  [
    body("isVisible").isBoolean().toBoolean(),
    body("trainingLevel").isIn(trainingLevels),
    body("goal").trim().notEmpty().isLength({ max: 200 }),
  ],
  validateRequest,
  asyncRoute(async (req, res) => {
    const [profile] = await CommunityProfile.findOrCreate({
      where: { memberId: req.member.id },
      defaults: {
        memberId: req.member.id,
        isVisible: false,
        trainingLevel: req.body.trainingLevel,
        goal: req.body.goal,
      },
    });
    await profile.update({
      isVisible: req.body.isVisible,
      trainingLevel: req.body.trainingLevel,
      goal: req.body.goal,
    });
    return res.json({
      isVisible: profile.isVisible,
      trainingLevel: profile.trainingLevel,
      goal: profile.goal,
    });
  }),
);

router.get(
  "/members",
  [query("search").optional().trim().isLength({ max: 80 })],
  validateRequest,
  asyncRoute(async (req, res) => {
    const search = req.query.search;
    const visibleProfiles = await CommunityProfile.findAll({
      where: { isVisible: true },
      attributes: ["memberId", "trainingLevel", "goal", "isVisible"],
      include: [{
        model: Member,
        required: true,
        attributes: ["id", "firstName", "profilePhotoUpdatedAt"],
        where: {
          status: "active",
          id: { [Op.ne]: req.member.id },
          ...(search ? { firstName: { [Op.iLike]: `%${search}%` } } : {}),
        },
      }],
      order: [[Member, "firstName", "ASC"]],
      limit: 100,
    });
    const candidateIds = visibleProfiles.map((profile) => profile.memberId);
    if (candidateIds.length === 0) return res.json({ members: [] });

    const [connections, blocks] = await Promise.all([
      CommunityConnection.findAll({
        where: {
          [Op.or]: [
            { memberA: req.member.id, memberB: { [Op.in]: candidateIds } },
            { memberB: req.member.id, memberA: { [Op.in]: candidateIds } },
          ],
        },
      }),
      CommunityBlock.findAll({
        where: {
          [Op.or]: [
            { blockedBy: req.member.id, blockedMemberId: { [Op.in]: candidateIds } },
            { blockedMemberId: req.member.id, blockedBy: { [Op.in]: candidateIds } },
          ],
        },
        attributes: ["blockedBy", "blockedMemberId"],
      }),
    ]);
    const connectionByMember = new Map(
      connections.map((connection) => [
        profileMemberId(connection, req.member.id),
        connection,
      ]),
    );
    const blockedIds = new Set(
      blocks.map((block) =>
        block.blockedBy === req.member.id ? block.blockedMemberId : block.blockedBy,
      ),
    );

    return res.json({
      members: visibleProfiles
        .filter((profile) => !blockedIds.has(profile.memberId))
        .map((profile) => {
          const connection = connectionByMember.get(profile.memberId);
          const friendStatus = !connection
            ? "none"
            : connection.status === "accepted"
              ? "friends"
              : connection.requestedBy === req.member.id
                ? "request_sent"
                : "request_received";
          return {
            ...publicMember(profile.Member, profile),
            friendStatus,
          };
        }),
    });
  }),
);

router.get(
  "/requests",
  asyncRoute(async (req, res) => {
    const connections = await CommunityConnection.findAll({
      where: {
        status: "pending",
        [Op.or]: [{ memberA: req.member.id }, { memberB: req.member.id }],
      },
      order: [["createdAt", "DESC"]],
    });
    const otherIds = [...new Set(
      connections.map((connection) => profileMemberId(connection, req.member.id)),
    )];
    const members = otherIds.length
      ? await Member.findAll({
          where: { id: { [Op.in]: otherIds } },
          attributes: ["id", "firstName", "profilePhotoUpdatedAt"],
          include: [{
            model: CommunityProfile,
            attributes: ["isVisible", "trainingLevel", "goal"],
            required: false,
          }],
        })
      : [];
    const membersById = new Map(members.map((member) => [member.id, member]));
    return res.json({
      incoming: connections
        .filter((connection) => connection.requestedBy !== req.member.id)
        .map((connection) => ({
          ...publicMember(
            membersById.get(profileMemberId(connection, req.member.id)),
            membersById.get(profileMemberId(connection, req.member.id))?.CommunityProfile,
          ),
          createdAt: connection.createdAt,
        })),
      outgoing: connections
        .filter((connection) => connection.requestedBy === req.member.id)
        .map((connection) => ({
          ...publicMember(
            membersById.get(profileMemberId(connection, req.member.id)),
            membersById.get(profileMemberId(connection, req.member.id))?.CommunityProfile,
          ),
          createdAt: connection.createdAt,
        })),
    });
  }),
);

router.get(
  "/friends",
  asyncRoute(async (req, res) => {
    const connections = await CommunityConnection.findAll({
      where: {
        status: "accepted",
        [Op.or]: [{ memberA: req.member.id }, { memberB: req.member.id }],
      },
      order: [["updatedAt", "DESC"]],
    });
    const friendIds = [...new Set(
      connections.map((connection) => profileMemberId(connection, req.member.id)),
    )];
    const members = friendIds.length
      ? await Member.findAll({
          where: { id: { [Op.in]: friendIds } },
          attributes: ["id", "firstName", "profilePhotoUpdatedAt"],
          include: [{
            model: CommunityProfile,
            attributes: ["isVisible", "trainingLevel", "goal"],
            required: false,
          }],
        })
      : [];
    const membersById = new Map(members.map((member) => [member.id, member]));
    return res.json({
      friends: connections.map((connection) => {
        const friend = membersById.get(profileMemberId(connection, req.member.id));
        return {
          ...publicMember(friend, friend?.CommunityProfile),
          connectedAt: connection.updatedAt,
        };
      }),
    });
  }),
);

router.post(
  "/requests/:memberId",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const targetId = req.params.memberId;
    if (targetId === req.member.id) {
      return res.status(400).json({ error: "No puedes enviarte una solicitud de amistad." });
    }
    const target = await CommunityProfile.findOne({
      where: { memberId: targetId, isVisible: true },
      include: [{
        model: Member,
        required: true,
        where: { status: "active" },
        attributes: ["id"],
      }],
    });
    if (!target || await isBlocked(req.member.id, targetId)) {
      return res.status(404).json({ error: "No se encontró un perfil disponible para agregar." });
    }
    const existing = await getPairConnection(req.member.id, targetId);
    if (existing) {
      return res.status(409).json({ error: "Ya son amigos en la comunidad." });
    }
    const pending = await getPairConnection(req.member.id, targetId, "pending");
    if (pending) {
      return res.status(409).json({
        error: pending.requestedBy === req.member.id
          ? "Ya enviaste una solicitud a esta persona."
          : "Esta persona ya te envió una solicitud. Revisa tus solicitudes recibidas.",
      });
    }
    try {
      await CommunityConnection.create({
        ...orderedMembers(req.member.id, targetId),
        requestedBy: req.member.id,
        status: "pending",
      });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({ error: "La solicitud ya fue enviada o recibida." });
      }
      throw error;
    }
    return res.status(201).json({ status: "pending" });
  }),
);

router.post(
  "/requests/:memberId/accept",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const connection = await CommunityConnection.findOne({
      where: {
        ...orderedMembers(req.member.id, req.params.memberId),
        status: "pending",
        requestedBy: { [Op.ne]: req.member.id },
      },
    });
    if (!connection || await isBlocked(req.member.id, req.params.memberId)) {
      return res.status(404).json({ error: "No se encontró una solicitud recibida disponible." });
    }
    await connection.update({ status: "accepted" });
    return res.json({ status: "accepted" });
  }),
);

router.delete(
  "/requests/:memberId",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const connection = await CommunityConnection.findOne({
      where: {
        ...orderedMembers(req.member.id, req.params.memberId),
        status: "pending",
      },
    });
    if (!connection) return res.status(404).json({ error: "No se encontró una solicitud pendiente." });
    await connection.destroy();
    return res.status(204).end();
  }),
);

router.delete(
  "/friends/:memberId",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const connection = await getPairConnection(req.member.id, req.params.memberId);
    if (!connection) return res.status(404).json({ error: "No se encontró esta amistad." });
    await connection.destroy();
    return res.status(204).end();
  }),
);

router.get(
  "/blocks",
  asyncRoute(async (req, res) => {
    const blocks = await CommunityBlock.findAll({
      where: { blockedBy: req.member.id },
      order: [["createdAt", "DESC"]],
    });
    const members = blocks.length
      ? await Member.findAll({
          where: { id: { [Op.in]: blocks.map((block) => block.blockedMemberId) } },
          attributes: ["id", "firstName"],
        })
      : [];
    return res.json({
      blockedMembers: members.map((member) => ({
        id: member.id,
        firstName: member.firstName,
        trainingLevel: null,
        goal: null,
      })),
    });
  }),
);

router.post(
  "/blocks/:memberId",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const targetId = req.params.memberId;
    if (targetId === req.member.id) {
      return res.status(400).json({ error: "No puedes bloquear tu propia cuenta." });
    }
    const target = await Member.findOne({
      where: { id: targetId, status: "active" },
      attributes: ["id"],
    });
    if (!target) return res.status(404).json({ error: "No se encontró este socio." });
    await CommunityBlock.findOrCreate({
      where: { blockedBy: req.member.id, blockedMemberId: targetId },
      defaults: { blockedBy: req.member.id, blockedMemberId: targetId },
    });
    await CommunityConnection.destroy({
      where: orderedMembers(req.member.id, targetId),
    });
    return res.status(201).json({ blocked: true });
  }),
);

router.delete(
  "/blocks/:memberId",
  [param("memberId").isInt({ min: 1 }).toInt()],
  validateRequest,
  asyncRoute(async (req, res) => {
    const deleted = await CommunityBlock.destroy({
      where: { blockedBy: req.member.id, blockedMemberId: req.params.memberId },
    });
    if (!deleted) return res.status(404).json({ error: "No se encontró este bloqueo." });
    return res.status(204).end();
  }),
);

router.post(
  "/reports/:memberId",
  [
    param("memberId").isInt({ min: 1 }).toInt(),
    body("reason").isIn(reportReasons),
    body("details").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validateRequest,
  asyncRoute(async (req, res) => {
    if (req.params.memberId === req.member.id) {
      return res.status(400).json({ error: "No puedes denunciar tu propia cuenta." });
    }
    const target = await Member.findOne({
      where: { id: req.params.memberId, status: "active" },
      attributes: ["id"],
    });
    if (!target) return res.status(404).json({ error: "No se encontró este socio." });
    const report = await CommunityReport.create({
      reporterId: req.member.id,
      reportedMemberId: target.id,
      reason: req.body.reason,
      details: req.body.details || null,
    });
    return res.status(201).json({ reportId: report.id, status: report.status });
  }),
);

router.get(
  "/messages/:memberId",
  [
    param("memberId").isInt({ min: 1 }).toInt(),
    query("afterId").optional().isInt({ min: 0 }).toInt(),
    query("wait").optional().isInt({ min: 0, max: 25 }).toInt(),
  ],
  validateRequest,
  asyncRoute(async (req, res) => {
    const friendId = req.params.memberId;
    if (
      friendId === req.member.id ||
      await isBlocked(req.member.id, friendId) ||
      !await getPairConnection(req.member.id, friendId)
    ) {
      return res.status(403).json({ error: "El chat solo está disponible entre amigos." });
    }
    const where = {
      [Op.or]: [
        { senderId: req.member.id, recipientId: friendId },
        { senderId: friendId, recipientId: req.member.id },
      ],
      ...(req.query.afterId === undefined ? {} : { id: { [Op.gt]: req.query.afterId } }),
    };
    const waitMs = req.query.afterId === undefined ? 0 : (req.query.wait || 0) * 1000;
    const deadline = Date.now() + waitMs;
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    let messages;
    for (;;) {
      messages = await CommunityMessage.findAll({
        where,
        order: [["id", req.query.afterId === undefined ? "DESC" : "ASC"]],
        limit: req.query.afterId === undefined ? 50 : 100,
      });
      const remaining = deadline - Date.now();
      if (messages.length || remaining <= 0 || closed) break;
      // El aviso en memoria despierta al instante; el tope de 1 s cubre otros orígenes.
      await waitForNewMessage(req.member.id, Math.min(1000, remaining));
    }
    if (closed) return undefined;
    if (req.query.afterId === undefined) messages.reverse();
    return res.json({
      messages: messages.map((message) => ({
        id: Number(message.id),
        senderId: message.senderId,
        recipientId: message.recipientId,
        body: message.body,
        createdAt: message.createdAt,
      })),
    });
  }),
);

router.post(
  "/messages/:memberId",
  [
    param("memberId").isInt({ min: 1 }).toInt(),
    body("body").trim().notEmpty().isLength({ max: 2000 }),
  ],
  validateRequest,
  asyncRoute(async (req, res) => {
    const friendId = req.params.memberId;
    if (
      friendId === req.member.id ||
      await isBlocked(req.member.id, friendId) ||
      !await getPairConnection(req.member.id, friendId)
    ) {
      return res.status(403).json({ error: "El chat solo está disponible entre amigos." });
    }
    const message = await CommunityMessage.create({
      senderId: req.member.id,
      recipientId: friendId,
      body: req.body.body,
    });
    notifyNewMessage(friendId);
    const sender = await Member.findByPk(req.member.id, {
      attributes: ["firstName"],
    });
    void sendPushToMember(friendId, {
      title: "Nuevo mensaje",
      body: "Tienes un nuevo mensaje en la comunidad.",
      data: {
        type: "community-message",
        memberId: req.member.id,
        name: sender.firstName,
      },
    }).catch((error) => {
      console.error("El mensaje se guardó, pero no se pudo enviar la notificación push:", error.message);
    });
    return res.status(201).json({
      message: {
        id: Number(message.id),
        senderId: message.senderId,
        recipientId: message.recipientId,
        body: message.body,
        createdAt: message.createdAt,
      },
    });
  }),
);

export default router;
