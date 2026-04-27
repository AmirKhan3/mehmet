#!/usr/bin/env node
/**
 * Chat eval harness — replays fixture conversations against local dev server,
 * verifies assertions, and writes a PASS/FAIL report.
 *
 * Usage:
 *   npm run eval                          # all fixtures
 *   npm run eval -- --fixture build-routine
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "tests/conversations");
const BASE_URL = process.env.EVAL_BASE_URL || "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL;

// Parse CLI args
const args = process.argv.slice(2);
const fixtureFilter = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;

// ---------------------------------------------------------------------------
// DB helpers (direct Postgres via neon HTTP)
// ---------------------------------------------------------------------------

async function dbQuery(sql, params = []) {
  if (!DB_URL) throw new Error("DATABASE_URL env var not set");
  const { neon } = await import("@neondatabase/serverless");
  const db = neon(DB_URL);
  // eslint-disable-next-line no-undef
  const result = await db.query(sql, params);
  return result.rows ?? result;
}

async function resetProfile() {
  await dbQuery(
    `UPDATE athlete_profile SET weight = NULL, height = NULL, goals = NULL, preferences = '{}'::jsonb WHERE id = 1`
  );
  await dbQuery(`DELETE FROM chat_messages WHERE TRUE`);
}

async function snapshotProfile() {
  const rows = await dbQuery(`SELECT weight, height, goals, preferences FROM athlete_profile WHERE id = 1 LIMIT 1`);
  return rows[0] || {};
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assertTurn(turnIndex, text, toolName, expect, history) {
  const failures = [];

  if (expect.contains) {
    for (const phrase of expect.contains) {
      if (!text.toLowerCase().includes(phrase.toLowerCase())) {
        failures.push(`expected contains "${phrase}"`);
      }
    }
  }

  if (expect.not_contains) {
    for (const phrase of expect.not_contains) {
      if (text.toLowerCase().includes(phrase.toLowerCase())) {
        failures.push(`unexpected phrase "${phrase}" found in response`);
      }
    }
  }

  if (expect.references_profile) {
    const allText = text + " " + history.map((m) => m.text).join(" ");
    for (const ref of expect.references_profile) {
      if (!allText.toLowerCase().includes(ref.toLowerCase())) {
        failures.push(`expected response to reference "${ref}" (known from earlier in conversation)`);
      }
    }
  }

  if (expect.length_min && text.length < expect.length_min) {
    failures.push(`narration too short (${text.length} < ${expect.length_min})`);
  }

  if (expect.length_max && text.length > expect.length_max) {
    failures.push(`narration too long (${text.length} > ${expect.length_max})`);
  }

  if (expect.tool !== undefined) {
    if (expect.tool === null && toolName) {
      failures.push(`expected no tool but got ${toolName}`);
    } else if (expect.tool !== null && toolName !== expect.tool) {
      failures.push(`expected tool "${expect.tool}" but got "${toolName || "null"}"`);
    }
  }

  return failures;
}

async function assertProfileAfter(profileExpect, snapshot) {
  const failures = [];
  const prefs = snapshot.preferences || {};

  for (const [key, value] of Object.entries(profileExpect)) {
    if (key.startsWith("preferences.")) {
      const prefKey = key.replace("preferences.", "");
      const actual = JSON.stringify(prefs[prefKey] || "").toLowerCase();
      if (!actual.includes(String(value).toLowerCase())) {
        failures.push(`profile.preferences.${prefKey}: expected to contain "${value}", got "${prefs[prefKey]}"`);
      }
    } else {
      const actual = String(snapshot[key] ?? "").toLowerCase();
      if (!actual.includes(String(value).toLowerCase())) {
        failures.push(`profile.${key}: expected "${value}", got "${snapshot[key]}"`);
      }
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Run one fixture
// ---------------------------------------------------------------------------

async function runFixture(fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  const name = path.basename(fixturePath, ".json");

  console.log(`\n## ${name}`);
  if (fixture.description) console.log(`> ${fixture.description}\n`);

  await resetProfile();

  const history = [];
  const rows = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i];
    let text = "";
    let toolName = null;

    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: turn.message, history: history.slice(-6) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      text = data.text || "";
      // extract tool name from cards if any
      if (data.cards && data.cards.length > 0) {
        toolName = data.cards[0]?.type || null;
      }
    } catch (err) {
      rows.push({ turn: i + 1, message: turn.message, result: "ERROR", notes: String(err) });
      failed++;
      continue;
    }

    history.push({ role: "user", text: turn.message });
    history.push({ role: "assistant", text });

    const failures = assertTurn(i, text, toolName, turn.expect || {}, history);

    // Check profile assertions if this is the last-mentioned profile_after
    if (turn.expect?.profile_after) {
      const snapshot = await snapshotProfile();
      const profileFailures = await assertProfileAfter(turn.expect.profile_after, snapshot);
      failures.push(...profileFailures);
    }

    if (failures.length === 0) {
      passed++;
      rows.push({ turn: i + 1, message: turn.message.slice(0, 50), result: "PASS", notes: text.slice(0, 80) });
    } else {
      failed++;
      rows.push({ turn: i + 1, message: turn.message.slice(0, 50), result: "FAIL", notes: failures.join("; ") });
    }
  }

  // Print table
  console.log("| Turn | Message | Result | Notes |");
  console.log("|------|---------|--------|-------|");
  for (const r of rows) {
    const icon = r.result === "PASS" ? "✓" : r.result === "FAIL" ? "✗" : "!";
    console.log(`| ${r.turn} | ${r.message} | ${icon} ${r.result} | ${r.notes} |`);
  }

  const total = passed + failed;
  console.log(`\n**Score: ${passed}/${total}**`);

  return { name, passed, failed, total, rows };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !fixtureFilter || f.startsWith(fixtureFilter))
    .map((f) => path.join(FIXTURES_DIR, f));

  if (files.length === 0) {
    console.error(`No fixtures found${fixtureFilter ? ` matching "${fixtureFilter}"` : ""}`);
    process.exit(1);
  }

  const today = new Date().toISOString().split("T")[0];
  const report = [`# Chat Eval — ${today}\n`];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const f of files) {
    const result = await runFixture(f);
    totalPassed += result.passed;
    totalFailed += result.failed;

    report.push(`## ${result.name}`);
    report.push(`| Turn | Message | Result | Notes |`);
    report.push(`|------|---------|--------|-------|`);
    for (const r of result.rows) {
      const icon = r.result === "PASS" ? "✓" : r.result === "FAIL" ? "✗" : "!";
      report.push(`| ${r.turn} | ${r.message} | ${icon} ${r.result} | ${r.notes} |`);
    }
    report.push(`\n**Score: ${result.passed}/${result.total}**\n`);
  }

  const reportPath = path.join(ROOT, "tests/eval-report.md");
  fs.writeFileSync(reportPath, report.join("\n"), "utf-8");

  console.log(`\n---`);
  console.log(`Total: ${totalPassed}/${totalPassed + totalFailed} passed`);
  console.log(`Report written to tests/eval-report.md`);

  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
