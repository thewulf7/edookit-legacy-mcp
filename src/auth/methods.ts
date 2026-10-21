import type { AuthMethod, AuthMethodId, ClientConfig } from "./types.js";
import { accessCodesAuthMethod } from "./methods/access-codes.js";
import { passwordAuthMethod } from "./methods/password.js";

/**
 * Registry of supported authentication methods.
 *
 * To add a method, implement `AuthMethod` in `./methods/<name>.ts` and append
 * it here. The rest of the login flow (browser context, prompt=none handling,
 * session persistence, error reporting) is shared.
 */
const AUTH_METHODS: AuthMethod[] = [passwordAuthMethod, accessCodesAuthMethod];

export function getAuthMethods(): readonly AuthMethod[] {
  return AUTH_METHODS;
}

/**
 * Pick a method when EDOOKIT_AUTH_METHOD is not set.
 *
 * Password comes first on purpose: an existing installation that has both
 * legacy credentials and access codes keeps its previous behaviour. Users who
 * want the newer method can set EDOOKIT_AUTH_METHOD=access-codes explicitly.
 */
export function detectAuthMethod(config: ClientConfig): AuthMethodId {
  if (config.username && config.password) return "password";
  if (config.accessCode1 && config.accessCode2) return "access-codes";
  throw new Error(
    "No Edookit authentication configured. Set EDOOKIT_USERNAME + EDOOKIT_PASSWORD " +
      "or EDOOKIT_ACCESS_CODE_1 + EDOOKIT_ACCESS_CODE_2."
  );
}

export function resolveAuthMethod(config: ClientConfig): AuthMethod {
  const id = config.authMethod ?? detectAuthMethod(config);
  const method = AUTH_METHODS.find((candidate) => candidate.id === id);
  if (!method) {
    throw new Error(`Unsupported Edookit auth method: ${id}.`);
  }
  if (!method.isConfigured(config)) {
    throw new Error(
      `Edookit auth method "${method.label}" is not fully configured. ${method.helpText}`
    );
  }
  return method;
}
