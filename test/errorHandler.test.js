import test from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../src/middleware/errorHandler.js";

function handle(error) {
  const response = {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  errorHandler(error, {}, response, () => {});
  return response;
}

test("returns a generic bad-request response for malformed JSON without reflecting its body", () => {
  const secretValue = "sensitive-test-value";
  const response = handle({
    type: "entity.parse.failed",
    body: JSON.stringify({ password: secretValue }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.stringify(response.body).includes(secretValue), false);
});

test("returns a payload-too-large response without exposing parser details", () => {
  const response = handle({ type: "entity.too.large", message: "private parser detail" });
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.stringify(response.body).includes("private parser detail"), false);
});

test("does not return database validation values in errors", () => {
  const response = handle({
    name: "SequelizeValidationError",
    message: "email: private@example.com is invalid",
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.stringify(response.body).includes("private@example.com"), false);
});
