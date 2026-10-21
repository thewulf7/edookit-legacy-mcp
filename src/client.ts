import * as fs from "fs";
import { load as cheerioLoad } from "cheerio";
import type { BrowserContext } from "playwright";
import { chromium } from "playwright";

import { loginWithContext, tryFastLogin } from "./auth/index.js";
import type { ClientConfig } from "./auth/types.js";
import {
  clearSessionStorage,
  loadSessionStorage,
  profileDir,
  profileDirPath,
} from "./session-storage.js";

export type { ClientConfig } from "./auth/types.js";

// ── Persistent browser context (one per process, kept alive) ─────────────────
// The portal (edookit.net) binds PHPSESSID to the TLS client fingerprint.
// Raw Node.js https requests use a different TLS stack and always get 302'd
// back to /user/login even with the correct cookies. All HTTP requests must
// therefore run through the same Playwright browser context that authenticated.

let _ctx: BrowserContext | null = null;
let _ctxSchool: string | null = null;

async function getContext(cfg: ClientConfig): Promise<BrowserContext> {
  if (_ctx && _ctxSchool === cfg.school) return _ctx;

  // Close any previous context for a different school
  if (_ctx) {
    try { await _ctx.close(); } catch { /* ignore */ }
    _ctx = null;
  }

  const dir = profileDir(cfg.school);

  process.stderr.write("[edookit-portal] Launching persistent browser context...\n");
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    args: ["--no-sandbox"],
  });

  const baseUrl = `https://${cfg.school}.edookit.net`;

  // Check if we already have a valid session in the profile
  const existingCookies = await ctx.cookies(baseUrl);
  const hasSession = existingCookies.some((c) => c.name === "X-EdooAuthToken" || c.name === "PHPSESSID");

  if (hasSession) {
    // Verify the session is actually usable
    process.stderr.write("[edookit-portal] Found existing cookies, verifying session...\n");
    const testPage = await ctx.newPage();
    let sessionValid = false;
    try {
      // Navigate to login page — valid session redirects away, expired session stays
      await testPage.goto(`${baseUrl}/user/login`, {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      }).catch(() => {});
      const finalUrl = testPage.url();
      // If redirected away from /user/login — session is valid
      sessionValid = !finalUrl.includes("/user/login");
    } catch {
      // ignore, treat as expired
    } finally {
      try { await testPage.close(); } catch { /* ignore */ }
    }

    if (sessionValid) {
      process.stderr.write("[edookit-portal] Existing session is valid.\n");
      _ctx = ctx;
      _ctxSchool = cfg.school;
      return ctx;
    }

    process.stderr.write("[edookit-portal] Existing session expired, attempting Plus4U fast re-auth...\n");

    // Try headless re-auth by injecting saved Plus4U OIDC session storage.
    // This avoids spawning a new context or wiping the profile — just clears
    // the stale edookit cookies and lets the OIDC SDK renew them.
    const savedStorage = loadSessionStorage(cfg.school);
    if (savedStorage) {
      await ctx.clearCookies();
      const fastOk = await tryFastLogin(ctx, cfg, savedStorage);
      if (fastOk) {
        _ctx = ctx;
        _ctxSchool = cfg.school;
        return ctx;
      }
      process.stderr.write("[edookit-portal] Fast re-auth failed, falling back to form login...\n");
      clearSessionStorage(cfg.school);
    }

    // Fast path failed (or no saved storage) — wipe profile and do a full form login
    await ctx.clearCookies();
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Create a fresh context and log in directly (no verification check on brand-new session)
    const freshCtx = await chromium.launchPersistentContext(dir, { headless: true, args: ["--no-sandbox"] });
    await loginWithContext(freshCtx, cfg);
    _ctx = freshCtx;
    _ctxSchool = cfg.school;
    return freshCtx;
  }

  // No existing session — log in
  await loginWithContext(ctx, cfg);

  _ctx = ctx;
  _ctxSchool = cfg.school;
  return ctx;
}

// ── HTTP client (via Playwright browser context) ──────────────────────────────

/**
 * Send an AJAX request from within the authenticated browser page.
 * Automatically reads the uu.app.csrf cookie and sends it as X-CSRF-Token.
 * Returns the response body as a string.
 */
export async function portalAjax(
  cfg: ClientConfig,
  urlPath: string,
): Promise<string> {
  const ctx = await getContext(cfg);
  const baseUrl = `https://${cfg.school}.edookit.net`;
  const url = `${baseUrl}${urlPath}`;

  const page = await ctx.newPage();
  try {
    // Load a neutral page first so we're on the same origin (needed for credentials: "include")
    await page.goto(`${baseUrl}/timetable/`, { waitUntil: "networkidle", timeout: 25_000 });
    const cookies = await ctx.cookies(baseUrl);
    const csrf = cookies.find((c) => c.name === "uu.app.csrf")?.value ?? "";

    const body = await page.evaluate(
      async ({ reqUrl, csrfToken }) => {
        const r = await fetch(reqUrl, {
          method: "GET",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
            "Accept": "*/*",
          },
          credentials: "include",
        });
        return r.text();
      },
      { reqUrl: url, csrfToken: csrf }
    );
    return body;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

export async function portalFetch(
  cfg: ClientConfig,
  urlPath: string,
  options: {
    method?: string;
    body?: string | URLSearchParams;
    extraHeaders?: Record<string, string>;
    followRedirects?: boolean;
  } = {}
): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string }> {
  const ctx = await getContext(cfg);
  const baseUrl = `https://${cfg.school}.edookit.net`;
  const url = `${baseUrl}${urlPath}`;

  const { method = "GET", body, extraHeaders = {} } = options;

  let bodyStr: string | undefined;
  let contentType: string | undefined;
  if (body instanceof URLSearchParams) {
    bodyStr = body.toString();
    contentType = "application/x-www-form-urlencoded";
  } else if (typeof body === "string") {
    bodyStr = body;
    contentType = "application/json";
  }

  const makeRequest = (context: BrowserContext) =>
    async (targetUrl: string): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string }> => {
      // ctx.request is an isolated APIRequestContext that doesn't share cookies
      // with the browser's own cookie jar. Use a page navigation instead so the
      // same cookie store that authenticated is used for all requests.
      const page = await context.newPage();
      try {
        if (method !== "GET" && method !== "get" && bodyStr) {
          // POST: use page.evaluate to submit a fetch from within the browser
          await page.goto("about:blank");
          const result = await page.evaluate(
            async ({ url, method: m, body: b, headers: h }) => {
              const resp = await fetch(url, {
                method: m,
                headers: h,
                body: b,
                redirect: "follow",
                credentials: "include",
              });
              return {
                status: resp.status,
                finalUrl: resp.url,
                body: await resp.text(),
              };
            },
            { url: targetUrl, method, body: bodyStr, headers: { "Accept": "text/html,application/xhtml+xml,*/*", "Accept-Language": "cs,en;q=0.9", ...(contentType ? { "Content-Type": contentType } : {}), ...extraHeaders } }
          );
          return { status: result.status, headers: {}, body: result.body, finalUrl: result.finalUrl };
        }

        // GET: standard page navigation
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 25_000 });
        // Wait for any OIDC redirects to fully settle before reading finalUrl
        await page.waitForFunction(
          (lp: string) => !window.location.href.includes(lp),
          "/user/login",
          { timeout: 8_000 }
        ).catch(() => { /* best-effort — caller checks finalUrl */ });
        const finalUrl = page.url();
        const bodyText = await page.content();
        const response = null; // networkidle path doesn't expose response easily
        const status = finalUrl.includes("/user/login") ? 302 : 200;
        const resHeaders: Record<string, string> = {};
        return { status, headers: resHeaders, body: bodyText, finalUrl };
      } finally {
        try { await page.close(); } catch { /* ignore */ }
      }
    };

  let result = await makeRequest(ctx)(url);

  if (result.finalUrl.includes("/user/login")) {
    process.stderr.write("[edookit-portal] Session expired, re-authenticating...\n");
    // Wipe context and re-login
    try { await _ctx?.close(); } catch { /* ignore */ }
    _ctx = null;
    _ctxSchool = null;
    fs.rmSync(profileDirPath(cfg.school), { recursive: true, force: true });

    const freshCtx = await getContext(cfg);
    const freshResult = await makeRequest(freshCtx)(url);
    if (freshResult.finalUrl.includes("/user/login")) {
      throw new Error(
        "Authentication failed after re-login. Check the credentials for the configured Edookit auth method."
      );
    }
    return freshResult;
  }

  return result;
}

// Keep raw https for cases where Playwright context isn't available (unused internally now)
export { };

export function parseHtml(html: string) {
  return cheerioLoad(html);
}

export function extractToken(html: string, formSelector = "form"): string {
  const $ = parseHtml(html);
  return ($(formSelector).find('input[name="_token"]').val() as string) ?? "";
}

// Legacy exports kept for any callers
export async function getSessionCookies(cfg: ClientConfig): Promise<Array<{ name: string; value: string }>> {
  const ctx = await getContext(cfg);
  const baseUrl = `https://${cfg.school}.edookit.net`;
  const cookies = await ctx.cookies(baseUrl);
  return cookies.map((c) => ({ name: c.name, value: c.value }));
}

export function invalidateSession(school: string) {
  if (_ctxSchool === school) {
    _ctx?.close().catch(() => { /* ignore */ });
    _ctx = null;
    _ctxSchool = null;
  }
  try { fs.rmSync(profileDirPath(school), { recursive: true, force: true }); } catch { /* ignore */ }
  clearSessionStorage(school);
}
