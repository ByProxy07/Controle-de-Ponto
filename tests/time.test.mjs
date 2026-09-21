import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(
  new URL("../src/lib/timeUtils.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const u = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const day = "2026-09-10";
const entries = ["08:00", "12:00", "13:00", "17:48"].map((time, i) => ({
  id: String(i),
  user_id: "user",
  type: u.ORDER[i],
  timestamp: `${day}T${time}:00-03:00`,
}));
const profile = {
  attendance_start: "2026-09-01",
  work_schedule: { daily_target_minutes: 528, work_days: [1, 2, 3, 4, 5] },
};
test("historical day = 528 minutes, independent of today", () =>
  assert.equal(u.calculateWorkedMinutes(entries), 528));
test("completed historical summary has zero balance", () => {
  const d = u
    .summarizeMonth(
      entries,
      "2026-09",
      profile,
      new Date("2026-09-21T12:00:00Z"),
    )
    .find((d) => d.date === day);
  assert.equal(d.balanceMinutes, 0);
  assert.equal(d.status, "complete");
});
test("open historical interval never runs until now", () =>
  assert.equal(
    u.calculateWorkedMinutes(entries.slice(0, 1), true, new Date("2026-09-21")),
    0,
  ));
test("first ongoing interval counts without requiring a second punch", () =>
  assert.equal(
    u.calculateWorkedMinutes(
      entries.slice(0, 1),
      true,
      new Date("2026-09-10T10:00:00-03:00"),
    ),
    120,
  ));
test("future weekdays do not create debt", () =>
  assert.equal(
    u
      .summarizeMonth([], "2026-10", profile, new Date("2026-09-21"))
      .reduce((a, d) => a + d.balanceMinutes, 0),
    0,
  ));
test("before attendance start does not create debt", () =>
  assert.equal(
    u
      .summarizeMonth([], "2026-08", profile, new Date("2026-09-21"))
      .reduce((a, d) => a + d.balanceMinutes, 0),
    0,
  ));
test("cancelled punches do not count", () =>
  assert.equal(
    u.calculateWorkedMinutes(
      entries.map((e) => ({ ...e, voided_at: "2026-09-11" })),
    ),
    0,
  ));
test("timezone groups UTC early hours into prior Brazil date", () =>
  assert.equal(u.dayKey("2026-09-11T01:00:00Z"), "2026-09-10"));
test("date-only strings display without shifting day", () =>
  assert.equal(u.formatDate("2026-09-10"), "10/09/2026"));
test("month bounds December rolls into January", () =>
  assert.deepEqual(u.monthBounds("2026-12"), {
    start: "2026-12-01T00:00:00-03:00",
    end: "2027-01-01T00:00:00-03:00",
  }));
test("partial historical day flagged rather than final deficit", () => {
  const d = u
    .summarizeMonth(
      entries.slice(0, 3),
      "2026-09",
      profile,
      new Date("2026-09-21"),
    )
    .find((d) => d.date === day);
  assert.equal(d.status, "partial");
  assert.equal(d.balanceMinutes, 0);
  assert.equal(d.workedMinutes, 240);
});
test("weekend complete day counts as surplus", () => {
  const sat = entries.map((e) => ({
    ...e,
    timestamp: e.timestamp.replace(day, "2026-09-12"),
  }));
  const d = u
    .summarizeMonth(sat, "2026-09", profile, new Date("2026-09-21"))
    .find((d) => d.date === "2026-09-12");
  assert.equal(d.balanceMinutes, 528);
});
test("invalid negative interval cannot subtract time", () =>
  assert.equal(
    u.calculateWorkedMinutes([
      { ...entries[0], timestamp: entries[1].timestamp },
      { ...entries[1], timestamp: entries[0].timestamp },
    ]),
    0,
  ));
