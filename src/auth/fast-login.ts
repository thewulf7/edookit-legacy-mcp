import type { BrowserContext } from "playwright";
import { hasAuthCookie } from "./browser.js";
import type { ClientConfig } from "./types.js";
import { saveSessionStorage } from "../session-storage.js";

/**
 * Attempt a fast (no-form) login by injecting saved Plus4U OIDC session
 * storage into the page before it loads, then letting the SDK do a silent
 * prompt=none callback. Returns true if Edookit auth cookies appeared.
 *
 * This is the existing fast re-auth introduced in 0472f83, extracted from
 * client.ts so every auth method can share it. It intentionally does not strip
 * prompt=none — the silent callback needs it.
 */
export async function tryFastLogin(
  context: BrowserContext,
  config: ClientConfig,
  savedStorage: Record<string, string>
): Promise<boolean> {
  const baseUrl = `https://${config.school}.edookit.net`;
  const page = await context.newPage();
  try {
    // Inject saved sessionStorage before any page JS runs (addInitScript fires
    // in the page context before the first script tag executes).
    await page.addInitScript((storage: Record<string, string>) => {
      try {
        Object.entries(storage).forEach(([key, value]) => sessionStorage.setItem(key, value));
      } catch { /* sandboxed context */ }
    }, savedStorage);

    // Do NOT strip prompt=none this time — we WANT the silent re-auth to work.
    await page.goto(`${baseUrl}/user/login`, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => {});

    // Wait up to 20 s for auth cookies (prompt=none is fast when it works).
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (hasAuthCookie(await context.cookies(baseUrl))) {
        // Confirm session by navigating to a real page.
        try {
          await page.goto(`${baseUrl}/overview/updates`, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          await page.waitForFunction(
            (loginPath: string) => !window.location.href.includes(loginPath),
            "/user/login",
            { timeout: 6_000 }
          ).catch(() => {});
        } catch { /* best-effort */ }
        process.stderr.write("[edookit-portal] Fast re-auth succeeded (Plus4U prompt=none).\n");
        // Refresh the saved session storage after a successful fast re-auth.
        await saveSessionStorage(page, config.school);
        return true;
      }
      await page.waitForTimeout(300);
    }
    return false;
  } catch {
    return false;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
