import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// No reset, migration-history write, committed DDL, or persistent fixture data.
// Each file runs in its own transaction against the existing FoodLens baseline.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--container")) {
  throw new Error(
    "Usage: node scripts/verify-meal-safety.mjs [--container NAME]",
  );
}
const container = args[1] ?? "supabase_db_foodlens-local";
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container))
  throw new Error("Choose an explicit existing Supabase database container.");
const migrations = [
  "supabase/migrations/20260906055734_feedback_collection_contract_v2.sql",
  "supabase/migrations/20260906063427_meal_safety_observations_v1.sql",
];
const tests = ["evidence_chain", "rls", "retention", "meal_safety"].map(
  (name) => `supabase/tests/${name}.sql`,
);
const sourcePaths = [
  ...migrations,
  ...tests,
  "lib/repositories/supabase.ts",
  "lib/__tests__/supabase-meal-safety.test.ts",
  "lib/meal-safety.ts",
  "scripts/verify-meal-safety.mjs",
];
const sources = new Map(
  sourcePaths.map((name) => [
    name,
    readFileSync(path.join(root, name), "utf8"),
  ]),
);
const sourceSha256 = Object.fromEntries(
  [...sources].map(([name, text]) => [
    name,
    createHash("sha256").update(text).digest("hex"),
  ]),
);
function sql(query) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: query,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.error) throw result.error;
  return result;
}
const probe =
  "select jsonb_build_object('migration_count',(select count(*) from supabase_migrations.schema_migrations),'safety_gate',to_regprocedure('public.foodlens_meal_safety_contract_version()'),'safety_table',to_regclass('public.meal_safety_observations'),'feedback_gate',to_regprocedure('public.foodlens_feedback_contract_version()'),'feedback_validator',to_regprocedure('private.validate_feedback_contract_v2(jsonb,jsonb,jsonb,integer)'),'meal_batches',(select count(*) from public.meal_batches),'contexts',(select count(*) from public.meal_contexts),'feedback',(select count(*) from public.feedback_events));";
const before = sql(probe);
if (before.status !== 0)
  throw new Error(before.stderr || "Baseline unavailable");
const baseline = JSON.parse(before.stdout.trim());
if (
  baseline.feedback_gate !== null ||
  baseline.feedback_validator !== null ||
  baseline.safety_gate !== null ||
  baseline.safety_table !== null
)
  throw new Error(
    "This transaction replay requires the pre-feedback-v2 and pre-safety-v1 baseline; choose a separate baseline container. It never removes an existing migration.",
  );
console.log(JSON.stringify({ container, baseline, sourceSha256 }, null, 2));
let total = 0;
let failed = false;
for (const name of tests) {
  const text = sources.get(name);
  const expected = Number(text.match(/select plan\((\d+)\);/)?.[1]);
  if (
    !expected ||
    !/^begin;/i.test(text) ||
    !/rollback;\s*$/i.test(text) ||
    (text.match(/select \* from finish\(\);/g) ?? []).length !== 1
  )
    throw new Error(`Unrecognized rollback pgTAP fixture: ${name}`);
  const fixture = text
    .replace(/^begin;/i, "")
    .replace(
      "select * from finish();",
      "set constraints all immediate;\nselect * from finish();",
    );
  const result = sql(
    `begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '45s';\n${migrations.map((name) => sources.get(name)).join("\n")}\n${fixture}`,
  );
  const passed = (result.stdout.match(/^ok \d+ /gm) ?? []).length;
  const hasFailures = /^not ok |^# Looks like/m.test(result.stdout);
  const rolledBack = /(?:^|\n)ROLLBACK\s*$/.test(result.stdout);
  const success =
    result.status === 0 && !hasFailures && passed === expected && rolledBack;
  console.log(
    JSON.stringify({
      test: name,
      exitCode: result.status,
      expected,
      passed,
      rolledBack,
      success,
    }),
  );
  if (!success) {
    console.error(result.stdout);
    console.error(result.stderr);
    failed = true;
  }
  total += passed;
}
const after = sql(probe);
const unchanged =
  after.status === 0 && before.stdout.trim() === after.stdout.trim();
console.log(
  JSON.stringify(
    { totalPassed: total, databaseUnchanged: unchanged, sourceSha256 },
    null,
    2,
  ),
);
if (!unchanged)
  console.error(
    "Database baseline changed; inspect before any further action.",
  );
process.exitCode = failed || !unchanged ? 1 : 0;
