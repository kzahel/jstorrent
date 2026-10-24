// Which deliveries in compat/deliveries.json the compatibility matrix still
// supports (docs/tactical/370-version-handshake-and-compatibility-reports.md).
// A delivery is supported while it is the newest of its surface, or until
// windowDays after a newer delivery of that surface first became public:
// users get the whole window to update after a successor ships.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DAY = 24 * 60 * 60 * 1000;

/** Compares dotted numeric versions such as "1.0.29" and "1.0.3". */
export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The date a supported delivery leaves the window (YYYY-MM-DD), or null
 * while no newer delivery of its surface is public.
 */
export function retirementDate(ledger, delivery) {
  const successors = (ledger.deliveries ?? [])
    .filter(
      (other) =>
        other.surface === delivery.surface &&
        other.status !== "withdrawn" &&
        typeof other.firstPublic === "string" &&
        compareVersions(other.version, delivery.version) > 0,
    )
    .map((other) => other.firstPublic)
    .sort();
  if (successors.length === 0) return null;
  const leaves = new Date(`${successors[0]}T00:00:00Z`).getTime() + ledger.windowDays * DAY;
  return new Date(leaves).toISOString().slice(0, 10);
}

/** Non-withdrawn deliveries still inside the support window on `today`. */
export function supportedDeliveries(ledger, today) {
  return (ledger.deliveries ?? []).filter((delivery) => {
    if (delivery.status === "withdrawn") return false;
    const leaves = retirementDate(ledger, delivery);
    return leaves === null || today < leaves;
  });
}

/** Today's date (YYYY-MM-DD), or COMPAT_TODAY when set, for reproducible runs. */
export function compatToday(environment = process.env) {
  const override = environment.COMPAT_TODAY;
  if (override !== undefined && override !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) throw new Error("COMPAT_TODAY must be YYYY-MM-DD");
    return override;
  }
  return new Date().toISOString().slice(0, 10);
}

// `node scripts/compat-window.mjs` prints the supported deliveries as JSON,
// for tests/interop/compat_live_matrix.py.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ledger = JSON.parse(
    readFileSync(new URL("../compat/deliveries.json", import.meta.url), "utf8"),
  );
  console.log(JSON.stringify(supportedDeliveries(ledger, compatToday())));
}
