// Checks the delivery ledger behind the mixed-version compatibility matrix
// (docs/tactical/359-mixed-version-compatibility-matrix.md):
//
//   node scripts/compat-ledger.mjs [--release <tag being released>] [--today YYYY-MM-DD]
//
// - Every delivery inside the support window, and the newest of each
//   surface, has a capture of its commit with the roles it needs.
// - Every production tag is in the ledger or explicitly excluded. The tag
//   being released may be missing; it is added once submitted.
// Needs the repository's tags (git fetch --tags).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_TAG = /^(desktop|android|headless|crostini|extension)-v\d+\.\d+\.\d+$/;
const STATUSES = new Set(["submitted", "published", "rolling-out", "withdrawn"]);
const ROLE_FILES = {
  host: ["v1.schema.json", "hello.json", "settings.json", "view-set-trace.json"],
  client: ["v1.schema.json", "client-decoder.mjs"],
};
const DAY = 24 * 60 * 60 * 1000;

export function checkLedger(ledger, { tags, release = null, today, captureHas }) {
  const problems = [];
  const deliveries = ledger.deliveries ?? [];
  const seen = new Set();
  for (const delivery of deliveries) {
    const id = `${delivery.surface} ${delivery.version}`;
    if (seen.has(id)) problems.push(`${id}: listed twice`);
    seen.add(id);
    if (!/^[0-9a-f]{40}$/.test(delivery.commit ?? "")) problems.push(`${id}: commit must be a full SHA`);
    if (!STATUSES.has(delivery.status)) problems.push(`${id}: unknown status ${delivery.status}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery.submitted ?? "")) problems.push(`${id}: submitted date missing`);
    if (!Array.isArray(delivery.roles) || delivery.roles.some((role) => !(role in ROLE_FILES))) {
      problems.push(`${id}: roles must be host and/or client`);
    }
  }
  const windowStart = new Date(`${today}T00:00:00Z`).getTime() - ledger.windowDays * DAY;
  const newest = new Map();
  for (const delivery of deliveries) {
    const date = delivery.firstPublic ?? delivery.submitted;
    if (date > (newest.get(delivery.surface)?.date ?? "")) {
      newest.set(delivery.surface, { date, delivery });
    }
  }
  for (const delivery of deliveries) {
    if (delivery.status === "withdrawn") continue;
    const date = delivery.firstPublic ?? delivery.submitted;
    const inWindow = new Date(`${date}T00:00:00Z`).getTime() >= windowStart;
    if (!inWindow && newest.get(delivery.surface)?.delivery !== delivery) continue;
    for (const role of delivery.roles ?? []) {
      for (const file of ROLE_FILES[role] ?? []) {
        if (!captureHas(delivery.commit, file)) {
          problems.push(
            `${delivery.surface} ${delivery.version}: capture ${delivery.commit.slice(0, 12)} lacks ${file} (${role}); run scripts/compat-capture.mjs`,
          );
        }
      }
    }
  }
  const recorded = new Set(deliveries.map((delivery) => delivery.tag).filter(Boolean));
  for (const tag of tags) {
    if (!PRODUCTION_TAG.test(tag) || tag === release || recorded.has(tag)) continue;
    if ((ledger.excluded ?? []).some((rule) => rule.tagPattern !== undefined && new RegExp(rule.tagPattern).test(tag))) {
      continue;
    }
    problems.push(`${tag}: production tag missing from compat/deliveries.json`);
  }
  return problems;
}

function main(argv) {
  const options = Object.fromEntries(
    argv.flatMap((value, index) => (value.startsWith("--") ? [[value.slice(2), argv[index + 1]]] : [])),
  );
  const tags = execFileSync("git", ["tag", "--list"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  if (!tags.some((tag) => PRODUCTION_TAG.test(tag))) {
    throw new Error("no production tags found; fetch them first (git fetch --tags)");
  }
  const ledger = JSON.parse(readFileSync(path.join(root, "compat/deliveries.json"), "utf8"));
  const problems = checkLedger(ledger, {
    tags,
    release: options.release ?? null,
    today: options.today ?? new Date().toISOString().slice(0, 10),
    captureHas: (commit, file) => existsSync(path.join(root, "compat/captures", commit, file)),
  });
  if (problems.length > 0) {
    for (const problem of problems) console.log(`::error::${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`compat ledger: ${ledger.deliveries.length} deliveries, all required captures present`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
