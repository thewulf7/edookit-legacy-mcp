import type { BrowserContext } from "playwright";
import { installPromptNoneStripper, waitForAuthCookie } from "./browser.js";
import { resolveAuthMethod } from "./methods.js";
import type { ClientConfig } from "./types.js";
import { saveSessionStorage } from "../session-storage.js";

/**
 * Run the configured authentication method in a fresh page and wait for the
 * Edookit session. The browser context is shared with all later requests, so
 * this is the only place where a form login happens.
 */
export async function loginWithContext(
  context: BrowserContext,
  config: ClientConfig
): Promise<void> {
  const baseUrl = `https://${config.school}.edookit.net`;
  const method = resolveAuthMethod(config);

  process.stderr.write(`[edookit-portal] Logging in with ${method.label}...\n`);

  const page = await context.newPage();
  await installPromptNoneStripper(page);

  try {
    await page.goto(`${baseUrl}/user/login`, {
      waitUntil: "load",
      timeout: 30_000,
    });

    await method.login({ page, context, baseUrl, config });
    process.stderr.write("[edookit-portal] Waiting for Edookit session...\n");

    if (!(await waitForAuthCookie(context, baseUrl, 30_000))) {
      throw new Error(`Login timed out using ${method.label}. ${method.helpText}`);
    }

    // Navigate to confirm the full OIDC callback and get a bound PHPSESSID.
    process.stderr.write("[edookit-portal] Auth cookies found, confirming session...\n");
    try {
      await page.goto(`${baseUrl}/overview/updates`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      await page.waitForFunction(
        (loginPath: string) => !window.location.href.includes(loginPath),
        "/user/login",
        { timeout: 8_000 }
      ).catch(() => { /* best-effort — portalFetch will re-auth if needed */ });
    } catch {
      // best-effort
    }

    process.stderr.write("[edookit-portal] Authentication successful.\n");
    await saveSessionStorage(page, config.school);
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
