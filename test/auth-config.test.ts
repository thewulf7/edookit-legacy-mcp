import assert from "node:assert/strict";
import test from "node:test";

import { loadClientConfig } from "../src/auth/config.js";
import { detectAuthMethod, resolveAuthMethod } from "../src/auth/methods.js";

test("legacy username/password configuration is auto-detected", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_USERNAME: "parent@example.com",
    EDOOKIT_PASSWORD: "secret",
  });

  assert.equal(config.authMethod, undefined);
  assert.equal(detectAuthMethod(config), "password");
  assert.equal(resolveAuthMethod(config).id, "password");
});

test("two access codes are auto-detected as +4U Access", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_ACCESS_CODE_1: "code-one",
    EDOOKIT_ACCESS_CODE_2: "code-two",
  });

  assert.equal(detectAuthMethod(config), "access-codes");
  assert.equal(resolveAuthMethod(config).id, "access-codes");
});

test("EDOOKIT_AUTH_METHOD overrides auto-detection", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_USERNAME: "parent@example.com",
    EDOOKIT_PASSWORD: "secret",
    EDOOKIT_ACCESS_CODE_1: "code-one",
    EDOOKIT_ACCESS_CODE_2: "code-two",
    EDOOKIT_AUTH_METHOD: "access-codes",
  });

  assert.equal(resolveAuthMethod(config).id, "access-codes");
});

test("password keeps precedence when both credential sets are present", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_USERNAME: "parent@example.com",
    EDOOKIT_PASSWORD: "secret",
    EDOOKIT_ACCESS_CODE_1: "code-one",
    EDOOKIT_ACCESS_CODE_2: "code-two",
  });

  assert.equal(detectAuthMethod(config), "password");
});

test("only one access code is rejected early", () => {
  assert.throws(
    () =>
      loadClientConfig({
        EDOOKIT_SCHOOL: "school",
        EDOOKIT_ACCESS_CODE_1: "code-one",
      }),
    /both EDOOKIT_ACCESS_CODE_1 and EDOOKIT_ACCESS_CODE_2/
  );
});

test("missing auth configuration produces a helpful error", () => {
  const config = loadClientConfig({ EDOOKIT_SCHOOL: "school" });
  assert.throws(() => resolveAuthMethod(config), /No Edookit authentication configured/);
});

test("explicit method with missing credentials produces a method-specific error", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_AUTH_METHOD: "password",
    EDOOKIT_USERNAME: "parent@example.com",
  });

  assert.throws(() => resolveAuthMethod(config), /EDOOKIT_PASSWORD/);
});

test("explicit access-codes method without codes produces a method-specific error", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: "school",
    EDOOKIT_AUTH_METHOD: "access-codes",
    EDOOKIT_USERNAME: "parent@example.com",
    EDOOKIT_PASSWORD: "secret",
  });

  assert.throws(() => resolveAuthMethod(config), /EDOOKIT_ACCESS_CODE_1/);
});

test("unsupported auth method is rejected", () => {
  assert.throws(
    () =>
      loadClientConfig({
        EDOOKIT_SCHOOL: "school",
        EDOOKIT_AUTH_METHOD: "magic",
      }),
    /Unsupported EDOOKIT_AUTH_METHOD "magic"/
  );
});

test("secrets are passed through unchanged", () => {
  const config = loadClientConfig({
    EDOOKIT_SCHOOL: " school ",
    EDOOKIT_USERNAME: " parent@example.com ",
    EDOOKIT_PASSWORD: " password with spaces ",
    EDOOKIT_ACCESS_CODE_1: "code+one",
    EDOOKIT_ACCESS_CODE_2: "code/two=",
  });

  assert.equal(config.school, "school");
  assert.equal(config.username, "parent@example.com");
  assert.equal(config.password, " password with spaces ");
  assert.equal(config.accessCode1, "code+one");
  assert.equal(config.accessCode2, "code/two=");
});
