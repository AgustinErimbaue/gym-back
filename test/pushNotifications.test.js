import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://gym_test:gym_test@127.0.0.1:5432/gym_test";

const { MemberPushToken } = await import("../src/models/index.js");
const { sendPushToMember, sendPromotionalPush } = await import("../src/services/pushNotifications.js");

async function withPushMocks({ devices, tickets }, run) {
  const originalFindAll = MemberPushToken.findAll;
  const originalDestroy = MemberPushToken.destroy;
  const originalFetch = globalThis.fetch;
  const destroyedTokens = [];
  let requestBody;
  let findAllOptions;

  MemberPushToken.findAll = async (options) => {
    findAllOptions = options;
    return devices.map((token) => ({ token }));
  };
  MemberPushToken.destroy = async ({ where }) => destroyedTokens.push(where.token[Symbol.for("in")]);
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: tickets }), { status: 200 });
  };

  try {
    await run({
      destroyedTokens,
      getRequestBody: () => requestBody,
      getFindAllOptions: () => findAllOptions,
    });
  } finally {
    MemberPushToken.findAll = originalFindAll;
    MemberPushToken.destroy = originalDestroy;
    globalThis.fetch = originalFetch;
  }
}

test("sends a private generic community notification through Expo", async () => {
  await withPushMocks({
    devices: ["ExponentPushToken[device_1]"],
    tickets: [{ status: "ok", id: "ticket-1" }],
  }, async ({ getFindAllOptions, getRequestBody }) => {
    const result = await sendPushToMember(7, {
      title: "Nuevo mensaje",
      body: "Tienes un nuevo mensaje en la comunidad.",
      data: { type: "community-message", memberId: 4 },
    });

    assert.deepEqual(result, { devices: 1, accepted: 1, rejected: 0 });
    assert.equal(getRequestBody()[0].to, "ExponentPushToken[device_1]");
    assert.equal(getRequestBody()[0].data.memberId, 4);
    assert.equal(getRequestBody()[0].body.includes("contenido"), false);
    assert.deepEqual(getFindAllOptions().include[0].where, { status: "active" });
  });
});

test("removes Expo tokens rejected as no longer registered", async () => {
  await withPushMocks({
    devices: ["ExpoPushToken[expired_device]"],
    tickets: [{
      status: "error",
      message: "The recipient is not registered.",
      details: { error: "DeviceNotRegistered" },
    }],
  }, async ({ destroyedTokens }) => {
    const result = await sendPromotionalPush({
      title: "Aviso",
      body: "Promoción nueva",
      data: { type: "promotion" },
    });

    assert.deepEqual(result, { devices: 1, accepted: 0, rejected: 1 });
    assert.deepEqual(destroyedTokens, [["ExpoPushToken[expired_device]"]]);
  });
});

test("does not call Expo when a member has no registered devices", async () => {
  await withPushMocks({ devices: [], tickets: [] }, async () => {
    const result = await sendPushToMember(7, {
      title: "Nuevo mensaje",
      body: "Tienes un nuevo mensaje en la comunidad.",
      data: { type: "community-message", memberId: 4 },
    });
    assert.deepEqual(result, { devices: 0, accepted: 0, rejected: 0 });
  });
});
