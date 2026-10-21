import assert from "node:assert/strict";
import test from "node:test";

import { parseDashboard } from "../src/tools.js";

test("dashboard reads the current Edookit student markup", () => {
  const dashboard = parseDashboard(`
    <div class="student-container">
      <div class="student">
        <span class="name">Žák Jedna</span>
        <span class="class">II. ročník</span>
      </div>
      <div class="student">
        <span class="name">Žák Dva</span>
        <span class="class">I. ročník</span>
      </div>
    </div>
    <div class="dashboard-timetable">
      <div class="lesson">Matematika</div>
    </div>
  `);

  assert.equal(dashboard.student, "Žák Jedna");
  assert.deepEqual(dashboard.students, [
    { name: "Žák Jedna", class: "II. ročník" },
    { name: "Žák Dva", class: "I. ročník" },
  ]);
  assert.deepEqual(dashboard.timetableHighlights, ["Matematika"]);
});

test("dashboard falls back to the legacy student selector", () => {
  const dashboard = parseDashboard(`
    <div class="student-name">Legacy Student</div>
  `);

  assert.equal(dashboard.student, "Legacy Student");
  assert.deepEqual(dashboard.students, []);
});

test("dashboard returns Unknown when no student markup is present", () => {
  const dashboard = parseDashboard("<html><body></body></html>");

  assert.equal(dashboard.student, "Unknown");
  assert.deepEqual(dashboard.students, []);
});
