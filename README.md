# edookit-legacy-mcp

MCP server for the Edookit **parent/student portal** (`*.edookit.net`). Scrapes the portal web UI because the Edookit REST API is only available when separately enabled by the school.

## 22 tools

| Tool | Description |
|---|---|
| `portal_dashboard` | Main dashboard — students (name + class), pinned items, week's attendance, timetable highlights |
| `portal_inbox` | List inbox items; filter: all / unread / messages / events |
| `portal_evaluations` | Grades by subject, by date, or trends |
| `portal_assignments` | Homework — upcoming, today, recent, archive |
| `portal_exams` | Written tests and oral exams — upcoming or archive |
| `portal_materials` | Teaching/learning materials; optional course filter |
| `portal_lesson_plans` | Lesson plan / curriculum content per week |
| `portal_timetable` | Student timetable — current week, static, upcoming events, archive. Use `offset` (multiples of 7) to navigate weeks: `7` = next week, `-7` = last week, `14` = two weeks ahead, etc. Use `term` to select a school year (e.g. `2026/27`). |
| `portal_terms` | List available school terms/years |
| `portal_attendance` | Attendance records and stats (retroactive excuse, forward report, stats, overview) |
| `portal_excuse_absence` | Submit a retroactive absence excuse for specific dates |
| `portal_report_absence` | Report a future absence by day or by lesson |
| `portal_messages` | List inbox / sent / archive messages |
| `portal_get_message` | Full content of a single message by ID |
| `portal_send_message` | Compose and send a new message |
| `portal_payments` | Payment history and outstanding balances |
| `portal_discussions` | Parent-teacher discussion slots — upcoming or archive |
| `portal_courses` | Enrolled courses, class groups, course enrolments |
| `portal_portfolios` | Student portfolio work items |
| `portal_library` | Borrowed and available library books |
| `portal_consents` | Consent forms and their status |
| `portal_search` | Full-text search across the portal |

## Setup

### 1. Install via npx (no build needed)

Legacy Plus4U e-mail/password configuration (unchanged):

```json
{
  "mcpServers": {
    "edookit-portal": {
      "command": "npx",
      "args": ["github:thewulf7/edookit-legacy-mcp"],
      "env": {
        "EDOOKIT_SCHOOL": "your-school",
        "EDOOKIT_USERNAME": "your@email.com",
        "EDOOKIT_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Schools that use the newer Plus4U login page can use the two +4U Access codes instead:

```json
{
  "mcpServers": {
    "edookit-portal": {
      "command": "npx",
      "args": ["github:thewulf7/edookit-legacy-mcp"],
      "env": {
        "EDOOKIT_SCHOOL": "your-school",
        "EDOOKIT_AUTH_METHOD": "access-codes",
        "EDOOKIT_ACCESS_CODE_1": "your-first-code",
        "EDOOKIT_ACCESS_CODE_2": "your-second-code"
      }
    }
  }
}
```

### 2. Build from source (optional)

```bash
git clone https://github.com/thewulf7/edookit-legacy-mcp
cd edookit-legacy-mcp
npm install
npx playwright install chromium
npm run build
node dist/index.js
```

### 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `EDOOKIT_SCHOOL` | yes | Subdomain — if your portal is `https://zs-example.edookit.net`, use `zs-example` |
| `EDOOKIT_AUTH_METHOD` | no | Explicit auth method: `password` or `access-codes`. Usually auto-detected from the credentials below. |
| `EDOOKIT_USERNAME` | no | Legacy Plus4U login (email). Required for the `password` method. |
| `EDOOKIT_PASSWORD` | no | Legacy Plus4U password. Required together with `EDOOKIT_USERNAME`. |
| `EDOOKIT_ACCESS_CODE_1` | no | First +4U Access code. Required for the `access-codes` method. |
| `EDOOKIT_ACCESS_CODE_2` | no | Second +4U Access code. Required for the `access-codes` method. |

At least one complete authentication method must be configured: either `EDOOKIT_USERNAME` + `EDOOKIT_PASSWORD`, or `EDOOKIT_ACCESS_CODE_1` + `EDOOKIT_ACCESS_CODE_2`.

### 4. Authentication

Two methods are supported:

1. **Plus4U e-mail + password** (legacy, unchanged). Use `EDOOKIT_USERNAME` and `EDOOKIT_PASSWORD`.
2. **+4U Access codes** (new). Use `EDOOKIT_ACCESS_CODE_1` and `EDOOKIT_ACCESS_CODE_2`. The server opens the Plus4U login page, selects **+4U Access**, and submits both codes.

If `EDOOKIT_AUTH_METHOD` is not set, the method is auto-detected. When both credential sets are present, the legacy password method wins; set `EDOOKIT_AUTH_METHOD=access-codes` to opt into the newer method.

Both methods run headless via Playwright. After a successful login the server saves the Plus4U OIDC session to `~/.cache/edookit-legacy-mcp/profile-<school>/session-storage.json` and uses a fast silent re-auth on subsequent starts — no browser window, no manual steps.

Interactive login is not supported; credentials must be provided through the environment.

To force a full re-login, delete `~/.cache/edookit-legacy-mcp/profile-<school>/`.

The access codes and password are secrets. Do not commit them to a repository or share them in logs.

#### Adding a new authentication method

The login flow is pluggable:

1. Add the method ID to `AUTH_METHOD_IDS` in `src/auth/types.ts`.
2. Implement the `AuthMethod` interface in `src/auth/methods/<id>.ts`.
3. Register the implementation in `src/auth/methods.ts` and, if it should be auto-detected, extend `detectAuthMethod()`.
4. Document the new environment variables in this README.

`src/auth/login.ts` handles the shared browser context, `prompt=none` handling, session persistence, and error reporting, so a new method only needs to describe its own credential form interaction.

## Notes

- **Read-only by default** — only `portal_excuse_absence`, `portal_report_absence`, and `portal_send_message` submit data.
- All text is in Czech (the portal language); field values are returned as-is.
- Pages with no data return empty arrays — this is normal for accounts with no activity yet.
- `portal_search` depends on whether the school has search enabled in their Edookit instance.
- `portal_timetable` with `offset` fires a server-side session filter via AJAX before fetching the page, so the offset persists for the duration of the MCP process session.
