import { clickEdookitLoginButton, clickSubmit, waitForAuthCookie } from "../browser.js";
import type { AuthMethod } from "../types.js";

/**
 * +4U Access login with two access codes.
 *
 * Edookit schools that use the newer Plus4U login page offer a
 * "Continue with +4U Access" link instead of an e-mail/password form. The
 * access code inputs are stable (`accessCode1`, `accessCode2`); the submit
 * button is selected by class so the flow also works with the Czech UI.
 */
export const accessCodesAuthMethod: AuthMethod = {
  id: "access-codes",
  label: "+4U Access codes",
  helpText: "Check EDOOKIT_ACCESS_CODE_1 and EDOOKIT_ACCESS_CODE_2.",
  isConfigured: (config) => Boolean(config.accessCode1 && config.accessCode2),
  async login({ page, context, baseUrl, config }) {
    await clickEdookitLoginButton(page);

    // Reuse an existing Plus4U SSO session when possible.
    if (await waitForAuthCookie(context, baseUrl, 2_000)) {
      process.stderr.write("[edookit-portal] Existing Plus4U SSO session detected.\n");
      return;
    }

    // Some Plus4U pages show the access-code form directly, others require
    // clicking the "+4U Access" link first. The Plus4U SPA can take a moment
    // to render either one, so wait for both possibilities before deciding.
    const accessCodeInput = page.locator('input[name="accessCode1"]');
    const accessLink = page.locator("a, button", { hasText: "+4U Access" }).first();

    if (!(await accessCodeInput.first().isVisible().catch(() => false))) {
      await Promise.race([
        accessCodeInput.waitFor({ state: "visible", timeout: 20_000 }),
        accessLink.waitFor({ state: "visible", timeout: 20_000 }),
      ]).catch(() => {});
    }

    // The Plus4U login is a client-rendered SPA. The link can become visible a
    // moment before its click handler is attached, so retry the click if the
    // form does not appear right away.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await accessCodeInput.first().isVisible().catch(() => false)) break;
      if ((await accessLink.count()) > 0 && (await accessLink.isVisible().catch(() => false))) {
        await accessLink.click({ force: true });
      }
      try {
        await accessCodeInput.waitFor({ state: "visible", timeout: 5_000 });
        break;
      } catch {
        // Retry the link click once the SPA has settled.
      }
    }

    await accessCodeInput.waitFor({ state: "visible", timeout: 15_000 });
    await accessCodeInput.fill(config.accessCode1!);
    await page.fill('input[name="accessCode2"]', config.accessCode2!);
    await clickSubmit(page, true);
  },
};
