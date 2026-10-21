import type { BrowserContext, Page } from "playwright";

const AUTH_COOKIE_NAMES = new Set(["X-EdooAuthToken", "X-Auth-Id"]);

/** True when the context already carries an Edookit auth cookie. */
export function hasAuthCookie(cookies: Array<{ name: string }>): boolean {
  return cookies.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name));
}

/** Poll the browser cookie jar until an Edookit auth cookie appears. */
export async function waitForAuthCookie(
  context: BrowserContext,
  baseUrl: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasAuthCookie(await context.cookies(baseUrl))) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Remove `prompt=none` from Plus4U OIDC redirects.
 *
 * With `prompt=none` Plus4U tries a silent SSO login and skips the credential
 * form. For an interactive form login we want the form, so the parameter must
 * be removed. This intentionally does not depend on a school-specific client
 * ID — every Edookit school can have a different Plus4U OIDC client.
 */
export async function installPromptNoneStripper(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.includes("prompt=none")) {
      return route.continue();
    }

    const parsed = new URL(url);
    parsed.searchParams.delete("prompt=none");
    return route.continue({ url: parsed.toString() });
  });
}

/**
 * Wait for the Edookit login page to settle, then click the landing-page button
 * that opens the Plus4U SSO flow.
 *
 * Some Edookit instances embed the Plus4U form directly (no landing button).
 * In that case the username field is the signal that the form is ready and no
 * click is needed.
 */
export async function clickEdookitLoginButton(page: Page): Promise<void> {
  const button = page.locator(".plus4ULoginButton").first();
  const embeddedForm = page.locator('input[name="username"]').first();

  await Promise.race([
    button.waitFor({ state: "visible", timeout: 15_000 }),
    embeddedForm.waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => {});

  if (await button.isVisible().catch(() => false)) {
    // Give the page a moment to attach the SPA click handler.
    await page.waitForTimeout(500);
    await button.click({ force: true });
    await page.waitForTimeout(1_000);
  }
}

/**
 * Click the visible Plus4U submit/continue button.
 *
 * `uuelements-1gc3md2` is the generated Plus4U design-system class. The text
 * changes with the UI language, which is why we prefer the stable class and
 * fall back to standard submit inputs.
 */
export async function clickSubmit(page: Page, preferLast = false): Promise<void> {
  const selectors = [
    "button.uuelements-1gc3md2:visible",
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) continue;

    const indexes = Array.from({ length: count }, (_, index) => index);
    if (preferLast) indexes.reverse();

    for (const index of indexes) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ force: true });
        return;
      }
    }
  }

  throw new Error("Could not find the Plus4U submit button.");
}
