import { loadClientConfig } from "./auth/config.js";
import { resolveAuthMethod } from "./auth/methods.js";
import { portalFetch, portalAjax, parseHtml, type ClientConfig } from "./client.js";

// ── helpers ────────────────────────────────────────────────────────────────

function cfg(): ClientConfig {
  const config = loadClientConfig();
  // Fail before launching a browser if the selected method lacks credentials.
  resolveAuthMethod(config);
  return config;
}

async function getPage(path: string) {
  const { body, finalUrl } = await portalFetch(cfg(), path);
  if (finalUrl.includes("/user/login") || finalUrl.includes("user/oidc")) {
    throw new Error("Authentication failed. Check the credentials for the configured Edookit auth method.");
  }
  return body;
}

// ── tool implementations ───────────────────────────────────────────────────

export function parseDashboard(html: string) {
  const $ = parseHtml(html);

  const student =
    $(".student-container .student .name").first().text().trim() ||
    $(".student-name, .user-name").first().text().trim() ||
    "Unknown";
  const students = $(".student-container .student")
    .map((_, el) => ({
      name: $(el).find(".name").text().trim(),
      class: $(el).find(".class").text().trim(),
    }))
    .get()
    .filter((s) => s.name);

  // Timetable blocks (current week mini-view on dashboard)
  const timetableItems: string[] = [];
  $(".dashboard-timetable .lesson, [class*='timetable'] a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text) timetableItems.push(text);
  });

  // Attendance summary
  const attendance = $("[class*='attendance'] [class*='day']")
    .map((_, el) => $(el).attr("title") || $(el).text().trim())
    .get()
    .filter(Boolean);

  // Unread counts from nav badges
  const unread: Record<string, string> = {};
  $(".nav-badge, .badge, .counter .unread").each((_, el) => {
    const count = $(el).text().trim();
    const label = $(el).closest("a").text().replace(count, "").trim();
    if (count && label) unread[label] = count;
  });

  // Pinned/starred inbox items
  const pinned: string[] = [];
  $(".starred .object-name, .pinned .object-name").each((_, el) => {
    pinned.push($(el).text().trim());
  });

  return {
    student,
    students,
    pinnedItems: pinned,
    attendanceThisWeek: attendance,
    timetableHighlights: timetableItems.slice(0, 10),
    unreadCounts: unread,
  };
}

export async function getDashboard() {
  return parseDashboard(await getPage("/"));
}

export async function getInbox(args: { filter?: "all" | "unread" | "messages" | "events" }) {
  const html = await getPage("/overview/updates");
  const $ = parseHtml(html);

  const items: Array<{
    id?: string;
    type: string;
    title: string;
    description: string;
    sender: string;
    date: string;
    unread: boolean;
    url?: string;
  }> = [];

  $(".item.clickable, .item[class*='Message'], .item[class*='event']").each((_, el) => {
    const $el = $(el);
    const classes = $el.attr("class") || "";
    const isUnread = classes.includes("unread");
    const type = classes.includes("message") ? "message"
      : classes.includes("event") ? "event"
      : classes.includes("assignment") ? "assignment"
      : classes.includes("exam") ? "exam"
      : classes.includes("material") ? "material"
      : "item";

    const title = $el.find(".object-name").text().trim();
    const description = $el.find(".description").text().trim();
    const sender = $el.find(".creator").text().trim();
    const date = $el.find(".time").text().trim();
    const url = $el.find("a[href]:not(.icon-link)").attr("href");

    if (title) {
      items.push({ type, title, description, sender, date, unread: isUnread, url });
    }
  });

  const filter = args.filter || "all";
  const filtered = filter === "unread" ? items.filter((i) => i.unread)
    : filter === "messages" ? items.filter((i) => i.type === "message")
    : filter === "events" ? items.filter((i) => i.type === "event")
    : items;

  const total = $(".counter .count").first().text().trim();
  const unreadCount = $(".counter .unread").first().text().trim();

  return { total: parseInt(total) || filtered.length, unread: parseInt(unreadCount) || 0, items: filtered };
}

export async function getEvaluations(args: { view?: "by-subject" | "by-date" | "trends" }) {
  const path = args.view === "by-date" ? "/evaluation/list"
    : args.view === "trends" ? "/evaluation/trends"
    : "/evaluation/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const subjects: Array<{
    name: string;
    grades: Array<{ label: string; value: string; date?: string; note?: string }>;
  }> = [];

  // by-subject view: .box elements per subject
  $(".box, .subject-box, [class*='subject']").each((_, el) => {
    const $el = $(el);
    const name = $el.find("h3, h4, .subject-name, .box-heading").first().text().trim();
    if (!name) return;

    const grades: Array<{ label: string; value: string; date?: string; note?: string }> = [];
    $el.find(".grade, .evaluation-item, td").each((_, g) => {
      const $g = $(g);
      const value = $g.find(".grade-value, .value").text().trim() || $g.text().trim();
      const date = $g.find(".date, time").text().trim();
      const note = $g.find(".note, .description").text().trim();
      const label = $g.find(".label, .name").text().trim();
      if (value) grades.push({ label, value, date, note });
    });
    if (grades.length) subjects.push({ name, grades });
  });

  // Fallback: table rows
  if (!subjects.length) {
    $("table tr").each((_, row) => {
      const cells = $(row).find("td").map((_, td) => $(td).text().trim()).get();
      if (cells.length >= 2) {
        subjects.push({ name: cells[0], grades: [{ label: "", value: cells.slice(1).join(" | ") }] });
      }
    });
  }

  return { path, subjects };
}

export async function getAssignments(args: { view?: "upcoming" | "archive" | "all" }) {
  const path = args.view === "archive" ? "/assignments/archive" : "/assignments/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const sections: Array<{
    heading: string;
    items: Array<{ title: string; subject?: string; dueDate?: string; description?: string; done?: boolean; url?: string }>;
  }> = [];

  $(".heading, h2").each((_, hEl) => {
    const heading = $(hEl).text().trim();
    const items: typeof sections[0]["items"] = [];

    $(hEl).nextUntil(".heading, h2").find(".box, .assignment-item, [class*='assignment']").each((_, item) => {
      const $item = $(item);
      const title = $item.find(".name, .title, h3, h4").first().text().trim() || $item.find("a").first().text().trim();
      const subject = $item.find(".subject, .course").text().trim();
      const dueDate = $item.find(".date, .due-date, time").text().trim();
      const description = $item.find(".description, .content").text().trim();
      const done = $item.find("input[type=checkbox]").is(":checked") || $item.hasClass("done");
      const url = $item.find("a[href]").attr("href");
      if (title) items.push({ title, subject, dueDate, description, done, url });
    });

    if (heading) sections.push({ heading, items });
  });

  return { path, sections };
}

export async function getExams(args: { view?: "upcoming" | "archive" }) {
  const path = args.view === "archive" ? "/exams/archive" : "/exams/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const items: Array<{
    title: string;
    subject?: string;
    date?: string;
    description?: string;
    url?: string;
  }> = [];

  $(".box, .exam-item, [class*='exam']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, h3, h4, a").first().text().trim();
    const subject = $el.find(".subject, .course").text().trim();
    const date = $el.find(".date, time").text().trim();
    const description = $el.find(".description, .content").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (title) items.push({ title, subject, date, description, url });
  });

  return { path, items };
}

export async function getMaterials(args: { courseId?: string }) {
  const path = args.courseId ? `/materials/?course=${args.courseId}` : "/materials/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const items: Array<{
    title: string;
    type?: string;
    subject?: string;
    date?: string;
    url?: string;
    attachments: string[];
  }> = [];

  $(".box, .material-item, [class*='material']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, h3, a").first().text().trim();
    const type = $el.find(".type, .category").text().trim();
    const subject = $el.find(".subject, .course").text().trim();
    const date = $el.find(".date, time").text().trim();
    const url = $el.find("a[href]").first().attr("href");
    const attachments = $el.find("a[href*='download'], a[href*='attachment'], a[href*='.pdf'], a[href*='.doc']")
      .map((_, a) => $(a).text().trim() || $(a).attr("href") || "")
      .get()
      .filter(Boolean);
    if (title) items.push({ title, type, subject, date, url, attachments });
  });

  return { path, items };
}

export async function getLessonPlans(args: { week?: string }) {
  const makePath = (week: string | undefined) => week ? `/lesson-plans/?week=${week}` : "/lesson-plans/";
  const html = await getPage(makePath(args.week));
  const $ = parseHtml(html);

  const lessons: Array<{
    date?: string;
    subject?: string;
    teacher?: string;
    topic?: string;
    homework?: string;
    note?: string;
  }> = [];

  $("tr, .lesson-item, .lesson-plan-item").each((_, el) => {
    const $el = $(el);
    const cells = $el.find("td").map((_, td) => $(td).text().trim()).get();
    if (cells.length >= 2) {
      lessons.push({
        date: cells[0],
        subject: cells[1],
        teacher: cells[2],
        topic: cells[3],
        homework: cells[4],
        note: cells[5],
      });
    }
  });

  return { path: makePath(args.week), lessons };
}

export async function getTerms() {
  const html = await getPage("/timetable/");
  const $ = parseHtml(html);

  const terms: Array<{ id: string; label: string; selected: boolean }> = [];
  $("a[href*=\"termSelector-new\"]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/termSelector-new=(\d+)/);
    if (m) {
      terms.push({
        id: m[1],
        label: $(el).text().trim(),
        selected: $(el).attr("class") === "selected",
      });
    }
  });

  return { terms };
}

export async function getTimetable(args: { view?: "current" | "static" | "upcoming" | "archive"; offset?: number; term?: string }) {
  const viewMap: Record<string, string> = {
    static: "/timetable/static",
    upcoming: "/timetable/upcoming",
    archive: "/timetable/archive",
  };
  let basePath = viewMap[args.view || ""] || "/timetable/";

  // If a term is requested, switch to it first by fetching the term-selector URL.
  // The portal sets a server-side session variable for the active term.
  if (args.term) {
    // First get the term list to resolve label → ID
    const termsHtml = await getPage("/timetable/");
    const $t = parseHtml(termsHtml);
    let termId: string | null = null;

    $t("a[href*=\"termSelector-new\"]").each((_, el) => {
      const href = $t(el).attr("href") || "";
      const m = href.match(/termSelector-new=(\d+)/);
      if (!m) return;
      const label = $t(el).text().trim();
      const id = m[1];
      // Match by ID directly or by year label (e.g. "2026/27" or "2026/2027")
      const normalise = (s: string) => s.replace(/\s/g, "").replace(/\/(\d{2})$/, (_, y) => `/${y}`);
      if (id === args.term || normalise(label) === normalise(args.term!)) {
        termId = id;
      }
    });

    if (!termId) {
      throw new Error(`Term "${args.term}" not found. Use getTerms to list available terms.`);
    }

    // Activate the term via AJAX with CSRF token (Nette requires X-CSRF-Token + X-Requested-With)
    await portalAjax(cfg(), `/timetable/?mainMenu-termSelector-new=${termId}&do=mainMenu-termSelector-change`);
  }

  // Week navigation is a Nette AJAX signal (requires X-Requested-With + CSRF),
  // same as term switching — use portalAjax, then fetch the plain timetable page.
  if (args.offset && args.view !== "static") {
    await portalAjax(cfg(), `/timetable/?familyTimetable-value=${args.offset}&do=familyTimetable-changeFilter`);
  }

  const html = await getPage(basePath);
  const $ = parseHtml(html);

  const heading = $("h2, h1").first().text().trim();

  // Detect the selected term label from the HTML
  const termLabel = $("#selected-term").text().trim() ||
    $("a.selected[href*='termSelector']").text().trim();

  const events: Array<{
    day?: string;
    time?: string;
    subject?: string;
    code?: string;
    cancelled?: boolean;
  }> = [];

  // Primary parser: .lesson-entry and .lessonRow contain "Day date, HH:MM Subject (CODE)"
  // e.g. "Út 1. 9. 2026, 8:30 Svět češtiny (CZE - 1.Q)"
  $(".lesson-entry, .lessonRow").each((_, el) => {
    const $el = $(el);
    const raw = $el.text().replace(/\s+/g, " ").trim();
    if (!raw) return;

    // Check if cancelled
    const cancelled = $el.hasClass("cancelled") ||
      raw.includes("Zrušeno") ||
      $el.find("[class*='cancel'], [class*='zrusen']").length > 0;

    // Try to extract "Day Date, Time Subject (CODE)" pattern
    // e.g. "Út 1. 9. 2026, 8:30 Svět češtiny (CZE - 1.Q)"
    const m = raw.match(/^([\wÚúČčŠšŽžÝýÁáÉéÍíÓóů]+\s+[\d.\s]+\d{4}),?\s+(\d+:\d+)\s+(.+?)(?:\s*\(([^)]+)\))?$/);
    if (m) {
      events.push({
        day: m[1].trim(),
        time: m[2],
        subject: m[3].trim(),
        code: m[4]?.trim(),
        cancelled,
      });
      return;
    }

    // Fallback: just grab the time from .date_time and the remaining text
    const time = $el.find(".date_time").text().trim();
    const subject = raw.replace(time, "").replace(/Zrušeno/g, "").trim();
    if (subject || time) {
      events.push({ time, subject: subject || raw, cancelled });
    }
  });

  return { heading, term: termLabel, path: basePath, events: events.slice(0, 100) };
}

export async function getAttendance(args: { view?: "excuse" | "report" | "report-lesson" | "excused" | "stats" | "overview" }) {
  const pathMap: Record<string, string> = {
    report: "/attendance/report",
    "report-lesson": "/attendance/report-lesson",
    excused: "/attendance/excused",
    stats: "/attendance/stats",
    overview: "/attendance/family-overview",
  };
  const path = pathMap[args.view || ""] || "/attendance/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const heading = $("h2, h1").first().text().trim();
  const description = $(".page-help").text().trim();

  const absences: Array<{
    date?: string;
    lesson?: string;
    subject?: string;
    status?: string;
    excuse?: string;
  }> = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td").map((_, td) => $(td).text().trim()).get();
    if (cells.length >= 2) {
      absences.push({
        date: cells[0],
        lesson: cells[1],
        subject: cells[2],
        status: cells[3],
        excuse: cells[4],
      });
    }
  });

  // Stats blocks
  const stats: Record<string, string> = {};
  $(".stat, .stats-item, [class*='stat']").each((_, el) => {
    const label = $(el).find(".label, .title").text().trim();
    const value = $(el).find(".value, .count").text().trim();
    if (label && value) stats[label] = value;
  });

  return { heading, description, path, absences, stats };
}

export async function excuseAbsence(args: { dates: string[]; reason: string }) {
  const html = await getPage("/attendance/");
  const $ = parseHtml(html);

  const token = $('input[name="_token"]').val() as string;
  if (!token) throw new Error("Could not find CSRF token on attendance page");

  // Build form data — check all provided dates
  const form = new URLSearchParams();
  form.set("_token", token);
  form.set("_do", "attendanceGrid-excuseSubmit");
  form.set("excuse", args.reason);

  // Find checkboxes for matching dates
  $('input[type="checkbox"][name*="absence"]').each((_, el) => {
    const $el = $(el);
    const rowText = $el.closest("tr").text();
    const matches = args.dates.some((d) => rowText.includes(d));
    if (matches) {
      form.append($el.attr("name") || "", $el.attr("value") || "1");
    }
  });

  const { status, body } = await portalFetch(cfg(), "/attendance/", {
    method: "POST",
    body: form,
    extraHeaders: { Referer: `https://${cfg().school}.edookit.net/attendance/` },
  });

  return {
    success: status < 400,
    message: status < 400 ? "Absence excuse submitted" : "Failed to submit excuse",
  };
}

export async function reportAbsence(args: {
  mode: "day" | "lesson";
  dateFrom: string;
  dateTo?: string;
  reason: string;
}) {
  const path = args.mode === "lesson" ? "/attendance/report-lesson" : "/attendance/report";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const token = $('input[name="_token"]').val() as string;
  if (!token) throw new Error("Could not find CSRF token");

  const form = new URLSearchParams();
  form.set("_token", token);
  form.set("_do", args.mode === "lesson" ? "reportLessonForm-submit" : "reportForm-submit");
  form.set("dateFrom", args.dateFrom);
  if (args.dateTo) form.set("dateTo", args.dateTo);
  form.set("reason", args.reason);

  const { status } = await portalFetch(cfg(), path, {
    method: "POST",
    body: form,
    extraHeaders: { Referer: `https://${cfg().school}.edookit.net${path}` },
  });

  return { success: status < 400, message: status < 400 ? "Absence reported" : "Failed to report absence" };
}

export async function getMessages(args: { view?: "inbox" | "sent" | "archive"; page?: number }) {
  const viewPath = args.view === "sent" ? "/messages/sent"
    : args.view === "archive" ? "/messages/archive"
    : "/overview/updates";
  const path = args.page && args.page > 1 ? `${viewPath}?page=${args.page}` : viewPath;

  const html = await getPage(path);
  const $ = parseHtml(html);

  const messages: Array<{
    id?: string;
    subject: string;
    sender: string;
    date: string;
    preview?: string;
    unread: boolean;
    url?: string;
  }> = [];

  $(".item.message, .item.inboxMessage").each((_, el) => {
    const $el = $(el);
    const subject = $el.find(".object-name").text().trim();
    const sender = $el.find(".creator").text().trim();
    const date = $el.find(".time").text().trim();
    const preview = $el.find(".description").text().trim();
    const unread = $el.hasClass("unread");
    const url = $el.find("a[href*='messages/detail'], a[href*='message=']").attr("href");
    const idMatch = url?.match(/message=(\d+)/);
    if (subject) messages.push({ id: idMatch?.[1], subject, sender, date, preview, unread, url });
  });

  return { view: args.view || "inbox", path, messages };
}

export async function getMessage(args: { id: string }) {
  const html = await getPage(`/messages/detail?message=${args.id}`);
  const $ = parseHtml(html);

  const subject = $("h2, h1, .message-subject").first().text().trim();
  const sender = $(".sender, .from, .creator").first().text().trim();
  const date = $("time, .date, .message-date").first().text().trim();
  const body = $(".message-body, .content, .ql-editor, [class*='body']").first().text().trim()
    || $(".message-text").text().trim();

  const attachments = $("a[href*='download'], a[href*='attachment']")
    .map((_, a) => ({ name: $(a).text().trim(), url: $(a).attr("href") }))
    .get();

  const replies: Array<{ sender: string; date: string; body: string }> = [];
  $(".reply, .message-reply, .thread-item").each((_, el) => {
    const $el = $(el);
    replies.push({
      sender: $el.find(".sender, .creator").text().trim(),
      date: $el.find("time, .date").text().trim(),
      body: $el.find(".body, .content, .ql-editor").text().trim(),
    });
  });

  return { id: args.id, subject, sender, date, body, attachments, replies };
}

export async function sendMessage(args: {
  to: string;
  subject: string;
  body: string;
}) {
  const html = await getPage("/messages/new");
  const $ = parseHtml(html);

  const token = $('input[name="_token"]').val() as string;
  if (!token) throw new Error("Could not find CSRF token on compose page");

  const form = new URLSearchParams();
  form.set("_token", token);
  form.set("_do", "messageForm-submit");
  form.set("subject", args.subject);
  form.set("body", args.body);
  form.set("recipients[]", args.to);

  const { status, body } = await portalFetch(cfg(), "/messages/new", {
    method: "POST",
    body: form,
    extraHeaders: { Referer: `https://${cfg().school}.edookit.net/messages/new` },
  });

  return { success: status < 400 && !body.includes("chyba"), message: status < 400 ? "Message sent" : "Failed to send" };
}

export async function getPayments(args: { personId?: string }) {
  const path = args.personId ? `/payments/?person=${args.personId}` : "/payments/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const summary: Record<string, string> = {};
  $("table.summary tr, .payments-summary tr").each((_, row) => {
    const cells = $(row).find("td, th").map((_, c) => $(c).text().trim()).get();
    if (cells.length >= 2) summary[cells[0].replace(":", "")] = cells[1];
  });

  // Also pick summary from rowheader/cell pairs
  $("table").first().find("tr").each((_, row) => {
    const header = $(row).find("[role='rowheader']").text().trim().replace(":", "");
    const value = $(row).find("[role='cell']").text().trim();
    if (header && value) summary[header] = value;
  });

  const payments: Array<{
    person?: string;
    description: string;
    status?: string;
    amount: string;
    bankAccount?: string;
    variableSymbol?: string;
    specificSymbol?: string;
  }> = [];

  $("[class*='payment-item'], .payment-row, [onclick*='payment']").each((_, el) => {
    const $el = $(el);
    const person = $el.find("[class*='student'], [class*='person']").text().trim();
    const description = $el.find("[class*='description'], [class*='name']").first().text().trim();
    const status = $el.find("[class*='status'], [class*='state']").text().trim();
    const amount = $el.find("[class*='amount'], [class*='sum'], [class*='price']").text().trim();
    const bankAccount = $el.find("td, [role='cell']").filter((_, c) => $(c).prev().text().includes("účtu")).text().trim();
    const varSym = $el.find("td, [role='cell']").filter((_, c) => $(c).prev().text().includes("ariabilní")).text().trim();
    const specSym = $el.find("td, [role='cell']").filter((_, c) => $(c).prev().text().includes("pecifický")).text().trim();
    if (description) payments.push({ person, description, status, amount, bankAccount, variableSymbol: varSym, specificSymbol: specSym });
  });

  // Fallback: scrape via table rows with rowheader
  if (!payments.length) {
    $("table").each((_, tbl) => {
      const rows = $(tbl).find("tr");
      rows.each((_, row) => {
        const ths = $(row).find("[rowheader], th").map((_, t) => $(t).text().trim()).get();
        const tds = $(row).find("td").map((_, t) => $(t).text().trim()).get();
        if (tds.length && ths.length) {
          ths.forEach((h, i) => { if (tds[i]) summary[h.replace(":", "")] = tds[i]; });
        }
      });
    });
  }

  return { path, summary, payments };
}

export async function getDiscussions(args: { view?: "upcoming" | "archive" }) {
  const path = args.view === "archive" ? "/discussions/archive" : "/discussions/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const items: Array<{
    title: string;
    date?: string;
    description?: string;
    url?: string;
  }> = [];

  $(".box, .discussion-item, [class*='discussion']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, h3, a").first().text().trim();
    const date = $el.find(".date, time").text().trim();
    const description = $el.find(".description, .content").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (title) items.push({ title, date, description, url });
  });

  return { path, items };
}

export async function getCourses(args: { view?: "list" | "groups" | "enroll" }) {
  const pathMap: Record<string, string> = {
    groups: "/groups/",
    enroll: "/courses/enroll",
  };
  const path = pathMap[args.view || ""] || "/courses/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const courses: Array<{
    name: string;
    teacher?: string;
    room?: string;
    url?: string;
  }> = [];

  $(".box, .course-item, [class*='course'], tr").each((_, el) => {
    const $el = $(el);
    const name = $el.find(".name, .title, h3, a, td:first-child").first().text().trim();
    const teacher = $el.find(".teacher, .lecturer").text().trim();
    const room = $el.find(".room").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (name && name.length > 1) courses.push({ name, teacher, room, url });
  });

  return { path, courses };
}

export async function getPortfolios(args: { studentId?: string }) {
  const path = args.studentId ? `/portfolios/?student=${args.studentId}` : "/portfolios/";
  const html = await getPage(path);
  const $ = parseHtml(html);

  const items: Array<{
    title: string;
    date?: string;
    type?: string;
    description?: string;
    url?: string;
  }> = [];

  $(".box, .portfolio-item, [class*='portfolio']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, h3, a").first().text().trim();
    const date = $el.find(".date, time").text().trim();
    const type = $el.find(".type, .category").text().trim();
    const description = $el.find(".description, .content").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (title) items.push({ title, date, type, description, url });
  });

  return { path, items };
}

export async function getLibrary() {
  const html = await getPage("/library/");
  const $ = parseHtml(html);

  const books: Array<{
    title: string;
    author?: string;
    status?: string;
    dueDate?: string;
    url?: string;
  }> = [];

  $(".box, .book-item, tr, [class*='library']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, a, td:first-child").first().text().trim();
    const author = $el.find(".author").text().trim();
    const status = $el.find(".status, .state").text().trim();
    const dueDate = $el.find(".due, .date, time").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (title && title.length > 1) books.push({ title, author, status, dueDate, url });
  });

  return { books };
}

export async function getConsents() {
  const html = await getPage("/consents/");
  const $ = parseHtml(html);

  const consents: Array<{
    title: string;
    status?: string;
    date?: string;
    description?: string;
    url?: string;
  }> = [];

  $(".box, .consent-item, tr, [class*='consent']").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".name, .title, h3, a, td:first-child").first().text().trim();
    const status = $el.find(".status, .state").text().trim();
    const date = $el.find(".date, time").text().trim();
    const description = $el.find(".description").text().trim();
    const url = $el.find("a[href]").attr("href");
    if (title && title.length > 1) consents.push({ title, status, date, description, url });
  });

  return { consents };
}

export async function searchPortal(args: { query: string }) {
  const html = await getPage(`/search/?q=${encodeURIComponent(args.query)}`);
  const $ = parseHtml(html);

  const results: Array<{ title: string; type?: string; url?: string; snippet?: string }> = [];

  $(".search-result, .result-item, [class*='result']").each((_, el) => {
    const $el = $(el);
    const title = $el.find("a, h3, .title").first().text().trim();
    const type = $el.find(".type, .category").text().trim();
    const url = $el.find("a[href]").attr("href");
    const snippet = $el.find(".snippet, .description, p").first().text().trim();
    if (title) results.push({ title, type, url, snippet });
  });

  return { query: args.query, results };
}
