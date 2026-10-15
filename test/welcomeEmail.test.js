import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRegistrationReceivedEmail,
  isReservedEmailAddress,
} from "../src/services/welcomeEmail.js";

test("detecta destinatarios .invalid que no pueden recibir correo", () => {
  assert.equal(isReservedEmailAddress("test@example.invalid"), true);
  assert.equal(isReservedEmailAddress("test@subdomain.invalid"), true);
  assert.equal(isReservedEmailAddress("person@example.com"), false);
});

test("marca el enlace ficticio como una demostración que no procesa pagos", () => {
  const email = buildRegistrationReceivedEmail({
    member: { firstName: "Ana", lastName: "Prueba", email: "ana@example.invalid" },
    plan: { name: "Esencial", description: "Acceso al gimnasio.", price: "79.00", durationDays: 30 },
    paymentUrl: "https://pago-de-prueba.ironcore.invalid/checkout/test-reference",
  });

  assert.equal(email.to, "ana@example.invalid");
  assert.match(email.text, /enlace ficticio de demostración/i);
  assert.match(email.text, /No ingreses datos de pago/);
  assert.match(email.text, /pago-de-prueba\.ironcore\.invalid/);
  assert.match(email.html, /enlace ficticio de demostración/i);
  assert.match(email.html, /Ver enlace ficticio de prueba/);
  assert.match(email.html, /No ingreses datos de pago/);
  assert.doesNotMatch(email.html, /Continuar al pago seguro/);
});

test("conserva el texto de pago seguro para enlaces reales", () => {
  const email = buildRegistrationReceivedEmail({
    member: { firstName: "Ana", lastName: "Prueba", email: "ana@example.invalid" },
    plan: { name: "Esencial", description: "Acceso al gimnasio.", price: "79.00", durationDays: 30 },
    paymentUrl: "https://www.mercadopago.com.ar/subscriptions/checkout",
  });

  assert.match(email.text, /enlace seguro de Mercado Pago/);
  assert.match(email.html, /Continuar al pago seguro/);
  assert.doesNotMatch(email.text, /enlace ficticio/);
});
