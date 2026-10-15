import test from "node:test";
import assert from "node:assert/strict";
import { registrationRateLimit } from "../src/middleware/registrationRateLimit.js";

function runRateLimit({ email, ip }) {
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let passed = false;
  registrationRateLimit({ body: { email }, ip }, response, () => {
    passed = true;
  });
  return { response, passed };
}

test("limits registration emails by normalized recipient", () => {
  const email = `security-test-${crypto.randomUUID()}@example.invalid`;
  assert.equal(runRateLimit({ email, ip: crypto.randomUUID() }).passed, true);
  assert.equal(runRateLimit({ email: email.toUpperCase(), ip: crypto.randomUUID() }).passed, true);

  const blocked = runRateLimit({ email, ip: crypto.randomUUID() });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.response.statusCode, 429);
  assert.ok(Number(blocked.response.headers["Retry-After"]) > 0);
  assert.equal(JSON.stringify(blocked.response.body).includes(email), false);
});

test("limits registration emails by client IP", () => {
  const ip = `security-test-${crypto.randomUUID()}`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(
      runRateLimit({ email: `${crypto.randomUUID()}@example.invalid`, ip }).passed,
      true,
    );
  }

  const blocked = runRateLimit({ email: `${crypto.randomUUID()}@example.invalid`, ip });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.response.statusCode, 429);
});

test("rejects a missing email without recording a rate-limit key", () => {
  const result = runRateLimit({ email: undefined, ip: crypto.randomUUID() });
  assert.equal(result.passed, false);
  assert.equal(result.response.statusCode, 400);
});
