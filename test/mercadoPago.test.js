import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createSubscriptionAuthorization,
  getArgentinaDate,
  getBillingPeriod,
  verifyMercadoPagoWebhook,
} from "../src/services/mercadoPago.js";

test("prorratea la primera membresía desde la fecha de alta hasta fin de mes", () => {
  assert.deepEqual(
    getBillingPeriod("2026-10-14", "2026-10-14T12:00:00-03:00"),
    { startDate: "2026-10-14", endDate: "2026-10-31", approvedDate: "2026-10-14" },
  );
});

test("renueva la membresía desde el primer día hasta fin de mes", () => {
  assert.deepEqual(
    getBillingPeriod("2026-10-14", "2026-11-01T03:00:00.000Z"),
    { startDate: "2026-11-01", endDate: "2026-11-30", approvedDate: "2026-11-01" },
  );
});

test("el acceso prorrateado comienza cuando el socio autoriza el cobro", () => {
  assert.deepEqual(
    getBillingPeriod("2026-10-14", "2026-10-15T12:00:00-03:00"),
    { startDate: "2026-10-15", endDate: "2026-10-31", approvedDate: "2026-10-15" },
  );
});

test("usa la fecha de Buenos Aires en los límites del mes", () => {
  assert.equal(getArgentinaDate(new Date("2026-11-01T02:59:59.000Z")), "2026-10-31");
  assert.equal(getArgentinaDate(new Date("2026-11-01T03:00:00.000Z")), "2026-11-01");
});

test("calcula correctamente febrero en un año bisiesto", () => {
  assert.deepEqual(
    getBillingPeriod("2028-02-14", "2028-02-14T12:00:00-03:00"),
    { startDate: "2028-02-14", endDate: "2028-02-29", approvedDate: "2028-02-14" },
  );
});

test("verifica la firma HMAC de webhooks de Mercado Pago", () => {
  const secret = "webhook-secret-for-test";
  const dataId = "12345";
  const requestId = "request-123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  const headers = {
    dataId,
    requestId,
    secret,
    signature: `ts=${timestamp},v1=${signature}`,
  };

  assert.equal(verifyMercadoPagoWebhook(headers), true);
  assert.equal(verifyMercadoPagoWebhook({ ...headers, dataId: "different-id" }), false);
  assert.equal(verifyMercadoPagoWebhook({ ...headers, signature: "v1=not-a-signature" }), false);
});

test("crea una autorización recurrente con prorrateo y cobro el día 1", async () => {
  const previousEnvironment = {
    token: process.env.MP_ACCESS_TOKEN,
    publicUrl: process.env.GYM_PUBLIC_URL,
    fetch: globalThis.fetch,
  };

  process.env.MP_ACCESS_TOKEN = "TEST-token";
  process.env.GYM_PUBLIC_URL = "http://localhost:5173";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.mercadopago.com/preapproval");
    assert.equal(options.headers.Authorization, "Bearer TEST-token");
    const request = JSON.parse(options.body);
    assert.equal(request.payer_email, "member@example.com");
    assert.equal(request.back_url, "http://localhost:5173/?checkout=mercadopago");
    assert.equal(request.auto_recurring.frequency, 1);
    assert.equal(request.auto_recurring.frequency_type, "months");
    assert.equal(request.auto_recurring.billing_day, 1);
    assert.equal(request.auto_recurring.billing_day_proportional, true);
    assert.equal(request.auto_recurring.transaction_amount, 35000);
    assert.equal(request.auto_recurring.currency_id, "ARS");
    return new Response(JSON.stringify({
      id: "subscription-test-id",
      init_point: "https://www.mercadopago.com.ar/subscriptions/checkout",
      status: "pending",
    }), { status: 201 });
  };

  try {
    const result = await createSubscriptionAuthorization({
      subscription: {
        externalReference: "subscription-reference",
        monthlyAmount: "35000.00",
        currency: "ARS",
        billingDay: 1,
      },
      member: { email: "member@example.com" },
      plan: { name: "Mensual" },
      backUrl: "http://localhost:5173/?checkout=mercadopago",
    });
    assert.equal(result.providerSubscriptionId, "subscription-test-id");
    assert.equal(result.status, "pending");
  } finally {
    if (previousEnvironment.token === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = previousEnvironment.token;
    if (previousEnvironment.publicUrl === undefined) delete process.env.GYM_PUBLIC_URL;
    else process.env.GYM_PUBLIC_URL = previousEnvironment.publicUrl;
    globalThis.fetch = previousEnvironment.fetch;
  }
});
