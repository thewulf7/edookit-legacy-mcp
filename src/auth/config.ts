import { AUTH_METHOD_IDS, type AuthMethodId, type ClientConfig } from "./types.js";

export type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

/**
 * Read the Edookit configuration from environment variables.
 *
 * Legacy `EDOOKIT_USERNAME` + `EDOOKIT_PASSWORD` keeps working unchanged.
 * New methods are selected either explicitly via `EDOOKIT_AUTH_METHOD` or
 * auto-detected from the credentials that are present.
 */
export function loadClientConfig(env: Env = process.env): ClientConfig {
  const school = nonEmpty(env.EDOOKIT_SCHOOL)?.trim();
  if (!school) throw new Error("Missing env var: EDOOKIT_SCHOOL");

  const username = nonEmpty(env.EDOOKIT_USERNAME)?.trim();
  const password = nonEmpty(env.EDOOKIT_PASSWORD);
  const accessCode1 = nonEmpty(env.EDOOKIT_ACCESS_CODE_1);
  const accessCode2 = nonEmpty(env.EDOOKIT_ACCESS_CODE_2);
  const rawAuthMethod = nonEmpty(env.EDOOKIT_AUTH_METHOD)?.trim();

  if ((accessCode1 && !accessCode2) || (!accessCode1 && accessCode2)) {
    throw new Error("Set both EDOOKIT_ACCESS_CODE_1 and EDOOKIT_ACCESS_CODE_2, or neither.");
  }

  let authMethod: AuthMethodId | undefined;
  if (rawAuthMethod) {
    if (!AUTH_METHOD_IDS.includes(rawAuthMethod as AuthMethodId)) {
      throw new Error(
        `Unsupported EDOOKIT_AUTH_METHOD "${rawAuthMethod}". ` +
          `Supported methods: ${AUTH_METHOD_IDS.join(", ")}.`
      );
    }
    authMethod = rawAuthMethod as AuthMethodId;
  }

  return { school, username, password, accessCode1, accessCode2, authMethod };
}
