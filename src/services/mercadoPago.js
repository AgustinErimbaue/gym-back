import { createHmac, timingSafeEqual } from "node:crypto";

const apiBaseUrl = "https://api.mercadopago.com";

export function isMercadoPagoConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN && process.env.MP_WEBHOOK_SECRET);
}

export function isPaymentDemoMode() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.MP_DEMO_MODE === "true" &&
    !isMercadoPagoConfigured()
  );
}

export function getGymPublicUrl() {
  const publicUrl = process.env.GYM_PUBLIC_URL ?? process.env.CORS_ORIGIN?.split(",")[0]?.trim();
  if (!publicUrl) {
    throw new Error("Configura GYM_PUBLIC_URL con la URL pública del panel.");
  }

  const url = new URL(publicUrl);
  const isDevelopmentUrl = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("GYM_PUBLIC_URL debe usar HTTPS en producción.");
  }
  if (url.protocol !== "https:" && !isDevelopmentUrl) {
    throw new Error("GYM_PUBLIC_URL debe usar HTTPS.");
  }

  return url.origin;
}

export function getMercadoPagoEnvironment() {
  const token = process.env.MP_ACCESS_TOKEN ?? "";
  if (token.startsWith("TEST-")) return "sandbox";
  if (token.startsWith("APP_USR-")) return "production";
  return "unconfigured";
}

export async function createSubscriptionAuthorization({ subscription, member, plan, backUrl }) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("Configura MP_ACCESS_TOKEN para activar los cobros automáticos.");
  }

  const publicUrl = getGymPublicUrl();
  const response = await fetch(`${apiBaseUrl}/preapproval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": subscription.externalReference,
    },
    body: JSON.stringify({
      reason: `IRONCORE - ${plan.name}`,
      external_reference: subscription.externalReference,
      payer_email: member.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(subscription.monthlyAmount),
        currency_id: subscription.currency,
        billing_day: subscription.billingDay,
        billing_day_proportional: true,
      },
      back_url: backUrl ?? `${publicUrl}/admin`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const result = await readProviderResponse(response, "No se pudo crear el enlace de pago recurrente.");
  if (typeof result.id !== "string" || typeof result.init_point !== "string") {
    throw new Error("Mercado Pago no devolvió una autorización de suscripción válida.");
  }

  return {
    providerSubscriptionId: result.id,
    initPoint: result.init_point,
    status: result.status === "authorized" ? "authorized" : "pending",
    nextPaymentDate: result.next_payment_date ?? null,
  };
}

export async function fetchMercadoPagoSubscription(id) {
  return mercadoPagoRequest(`/preapproval/${encodeURIComponent(id)}`);
}

export async function fetchMercadoPagoPayment(id) {
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(id)}`);
}

export async function cancelMercadoPagoSubscription(id) {
  return mercadoPagoRequest(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
}

export function verifyMercadoPagoWebhook({ dataId, requestId, signature, secret }) {
  if (!dataId || !requestId || !signature || !secret) return false;

  const fields = Object.fromEntries(
    signature.split(",").map((entry) => {
      const separator = entry.indexOf("=");
      return separator < 0 ? [entry, ""] : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
    }),
  );
  const timestamp = fields.ts;
  const providedSignature = fields.v1;
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60 ||
    !/^[a-f\d]{64}$/i.test(providedSignature ?? "")
  ) {
    return false;
  }

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expectedSignature = createHmac("sha256", secret).update(manifest).digest("hex");
  const expected = Buffer.from(expectedSignature, "hex");
  const provided = Buffer.from(providedSignature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function getArgentinaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getBillingPeriod(startDate, approvedAt) {
  const approvedDate = getArgentinaDate(new Date(approvedAt));
  const month = approvedDate.slice(0, 7);
  return {
    startDate: startDate.slice(0, 7) === month
      ? (startDate > approvedDate ? startDate : approvedDate)
      : `${month}-01`,
    endDate: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10),
    approvedDate,
  };
}

async function mercadoPagoRequest(path, options = {}) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no está configurado.");

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  return readProviderResponse(response, "No se pudo consultar la información de Mercado Pago.");
}

async function readProviderResponse(response, message) {
  const responseText = await response.text();
  let result;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Mercado Pago devolvió una respuesta inválida (HTTP ${response.status}).`);
    }
  }

  if (!response.ok) {
    console.error(`Mercado Pago request failed with HTTP ${response.status}.`);
    throw new Error(`${message} Mercado Pago respondió con HTTP ${response.status}.`);
  }

  if (!result || typeof result !== "object") {
    throw new Error("Mercado Pago devolvió una respuesta inválida.");
  }
  return result;
}
