import { clickEdookitLoginButton, clickSubmit, waitForAuthCookie } from "../browser.js";
import type { AuthMethod } from "../types.js";

/**
 * Legacy Plus4U e-mail + password login.
 *
 * This preserves the original edookit-legacy-mcp credential flow for backward
 * compatibility. It also handles the Plus4U login page embedded directly in
 * Edookit (without the `.plus4ULoginButton` landing step).
 */
export const passwordAuthMethod: AuthMethod = {
  id: "password",
  label: "Plus4U e-mail + password",
  helpText: "Check EDOOKIT_USERNAME and EDOOKIT_PASSWORD.",
  isConfigured: (config) => Boolean(config.username && config.password),
  async login({ page, context, baseUrl, config }) {
    await clickEdookitLoginButton(page);

    // A persistent Plus4U SSO session may already be authenticated.
    if (await waitForAuthCookie(context, baseUrl, 2_000)) {
      process.stderr.write("[edookit-portal] Existing Plus4U SSO session detected.\n");
      return;
    }

    await page.waitForSelector('input[name="username"]', { timeout: 20_000 });
    await page.fill('input[name="username"]', config.username!);
    await clickSubmit(page);

    await page.waitForSelector('input[name="password"]', { timeout: 15_000 });
    await page.fill('input[name="password"]', config.password!);
    await clickSubmit(page, true);
  },
};
