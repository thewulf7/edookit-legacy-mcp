import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Page } from "playwright";

// ── Persistent browser profile ──────────────────────────────────────────────
// The portal (edookit.net) binds PHPSESSID to the TLS client fingerprint.
// Raw Node.js https requests use a different TLS stack and always get 302'd
// back to /user/login even with the correct cookies. All HTTP requests must
// therefore run through the same Playwright browser context that authenticated.

export function profileDirPath(school: string): string {
  return path.join(os.homedir(), ".cache", "edookit-legacy-mcp", `profile-${school}`);
}

export function profileDir(school: string): string {
  const dir = profileDirPath(school);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ── Plus4U OIDC session storage helpers ──────────────────────────────────────
// After a successful Playwright form-login the Plus4U OIDC SDK keeps the
// session (id_token + refresh_token) in the page's sessionStorage. We persist
// it to disk so that the next startup can inject it back via addInitScript()
// before the OIDC SDK runs — letting Plus4U do a silent prompt=none re-auth
// instead of showing the credential form again.

const SESSION_STORAGE_FILE = "session-storage.json";

function sessionStoragePath(school: string): string {
  return path.join(profileDirPath(school), SESSION_STORAGE_FILE);
}

export function loadSessionStorage(school: string): Record<string, string> | null {
  const p = sessionStoragePath(school);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    return obj as Record<string, string>;
  } catch {
    return null;
  }
}

export async function saveSessionStorage(page: Page, school: string): Promise<void> {
  try {
    const storage = await page.evaluate((): Record<string, string> => {
      const items: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) items[key] = sessionStorage.getItem(key) ?? "";
      }
      return items;
    });
    if (Object.keys(storage).length > 0) {
      fs.mkdirSync(profileDirPath(school), { recursive: true, mode: 0o700 });
      fs.writeFileSync(sessionStoragePath(school), JSON.stringify(storage, null, 2), { mode: 0o600 });
      process.stderr.write("[edookit-portal] Saved Plus4U OIDC session storage for fast re-auth.\n");
    }
  } catch {
    // Non-critical — ignore
  }
}

export function clearSessionStorage(school: string): void {
  try { fs.rmSync(sessionStoragePath(school), { force: true }); } catch { /* ignore */ }
}
