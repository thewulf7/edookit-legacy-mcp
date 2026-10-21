import type { BrowserContext, Page } from "playwright";

/**
 * Canonical IDs of the supported authentication methods.
 *
 * Adding a new method:
 *   1. Add its ID here.
 *   2. Implement it in `src/auth/methods/<id>.ts`.
 *   3. Register it in `src/auth/methods.ts`.
 *   4. Document its environment variables in README.md.
 */
export const AUTH_METHOD_IDS = ["password", "access-codes"] as const;

export type AuthMethodId = (typeof AUTH_METHOD_IDS)[number];

export interface ClientConfig {
  school: string;
  /** Legacy Plus4U e-mail login. */
  username?: string;
  /** Legacy Plus4U password. */
  password?: string;
  /** First +4U Access code. */
  accessCode1?: string;
  /** Second +4U Access code. */
  accessCode2?: string;
  /** Explicit method selection. When omitted, the method is auto-detected. */
  authMethod?: AuthMethodId;
}

export interface LoginContext {
  page: Page;
  context: BrowserContext;
  baseUrl: string;
  config: ClientConfig;
}

export interface AuthMethod {
  id: AuthMethodId;
  /** Human-readable name used in logs and error messages. */
  label: string;
  /** Credential hint shown when login fails or the method is not configured. */
  helpText: string;
  /** Whether the credentials required by this method are present. */
  isConfigured(config: ClientConfig): boolean;
  /** Perform the method-specific steps on an already opened login page. */
  login(context: LoginContext): Promise<void>;
}
