import { buildDiagnostics } from "./diagnostics";
import type { SupportFacts } from "./about";

export const GITHUB_ISSUES_URL = "https://github.com/kzahel/jstorrent/issues";
export const FEEDBACK_PAGE_URL = "https://jstorrent.com/feedback.html";
export const SUPPORT_PAGE_URL = "https://jstorrent.com/support/";

/** A new GitHub issue whose body carries the bounded diagnostics report. */
export function githubIssueUrl(facts: SupportFacts): string {
  const body = [
    "### What happened?", "", "",
    "### What did you expect?", "", "",
    "### Steps to reproduce", "", "",
    "### Diagnostics", "", "```json", buildDiagnostics(facts).trimEnd(), "```", "",
  ].join("\n");
  return `${GITHUB_ISSUES_URL}/new?${new URLSearchParams({ body }).toString()}`;
}

/** The website feedback form with the context fields it accepts. */
export function feedbackPageUrl(facts: SupportFacts): string {
  const report = JSON.parse(buildDiagnostics(facts)) as Record<string, unknown>;
  const params = new URLSearchParams({ platform: platform(report) });
  for (const [key, field] of [["v", "version"], ["build", "build"], ["target", "target"],
    ["package", "package"], ["connection", "connection"]] as const) {
    const value = report[field];
    if (typeof value === "string" && value !== "unknown") params.set(key, value);
  }
  return `${FEEDBACK_PAGE_URL}?${params.toString()}`;
}

function platform(report: Record<string, unknown>): string {
  const target = typeof report.target === "string" ? report.target : "";
  if (target.endsWith("-android") || report.connection === "android-companion") return "android";
  if (target.endsWith("-apple-darwin")) return "mac";
  if (target.endsWith("-windows-msvc")) return "win";
  if (target.endsWith("linux-gnu")) return "linux";
  return report.connection === "desktop" ? "desktop" : "unknown";
}
