import { Op } from "sequelize";
import { Member, MemberPushToken } from "../models/index.js";

const expoPushUrl = "https://exp.host/--/api/v2/push/send";
const maxMessagesPerRequest = 100;

function pushHeaders() {
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }
  return headers;
}

async function sendPushMessages(messages) {
  let accepted = 0;
  let rejected = 0;
  const invalidTokens = [];

  for (let offset = 0; offset < messages.length; offset += maxMessagesPerRequest) {
    const batch = messages.slice(offset, offset + maxMessagesPerRequest);
    const response = await fetch(expoPushUrl, {
      method: "POST",
      headers: pushHeaders(),
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`Expo Push Service devolvió HTTP ${response.status}.`);
    }

    const result = await response.json();
    const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
    if (tickets.length !== batch.length) {
      throw new Error("Expo Push Service devolvió una cantidad de confirmaciones inesperada.");
    }

    tickets.forEach((ticket, index) => {
      if (ticket?.status === "ok") {
        accepted += 1;
        return;
      }
      rejected += 1;
      if (ticket?.details?.error === "DeviceNotRegistered") {
        invalidTokens.push(batch[index].to);
      }
    });
  }

  if (invalidTokens.length) {
    await MemberPushToken.destroy({
      where: { token: { [Op.in]: invalidTokens } },
    });
  }

  return { devices: messages.length, accepted, rejected };
}

function notificationForToken(token, { title, body, data }) {
  return {
    to: token,
    sound: "default",
    title,
    body,
    data,
    channelId: "default",
    priority: "high",
  };
}

export async function sendPushToMember(memberId, notification) {
  const devices = await MemberPushToken.findAll({
    where: { memberId },
    attributes: ["token"],
    include: [{
      model: Member,
      required: true,
      attributes: [],
      where: { status: "active" },
    }],
  });
  return sendPushMessages(
    devices.map(({ token }) => notificationForToken(token, notification)),
  );
}

export async function sendPromotionalPush(notification) {
  const devices = await MemberPushToken.findAll({
    attributes: ["token"],
    include: [{
      model: Member,
      required: true,
      attributes: [],
      where: { status: "active" },
    }],
  });
  return sendPushMessages(
    devices.map(({ token }) =>
      notificationForToken(token, {
        ...notification,
        data: { type: "promotion" },
      }),
    ),
  );
}
