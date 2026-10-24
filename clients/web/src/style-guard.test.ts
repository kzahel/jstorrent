import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Tactical 334: component CSS draws only from the global.css tokens so the
// light and dark themes stay coherent. Pre-bundle shells cannot see those
// tokens and are not checked here.
const SOURCE_ROOT = fileURLToPath(new URL(".", import.meta.url));

function moduleStylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return moduleStylesheets(path);
    }
    return entry.name.endsWith(".module.css") ? [path] : [];
  });
}

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly line: number;
}

function declarations(source: string): Declaration[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  const found: Declaration[] = [];
  const pattern = /([a-z-]+)\s*:\s*([^;{}]+);/g;
  for (const match of withoutComments.matchAll(pattern)) {
    const line = withoutComments.slice(0, match.index).split("\n").length;
    found.push({ property: match[1] ?? "", value: (match[2] ?? "").trim(), line });
  }
  return found;
}

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(|\b(?:white|black)\b/i;
const RADIUS_VALUE = /^(?:0|50%|inherit|var\(--radius-(?:sm|md|lg|full)\))$/;
const WEIGHT_VALUE = /^(?:inherit|var\(--weight-(?:regular|medium|strong)\))$/;
const FONT_SIZE_VALUE = /^(?:0|inherit|[0-9.]+em|var\(--ui-(?:font-[a-z]+|icon-size)\)|calc\(var\(--ui-(?:font-[a-z]+|icon-size)\)[^;]*\))$/;

function violations(path: string): string[] {
  const name = relative(SOURCE_ROOT, path);
  const problems: string[] = [];
  for (const { property, value, line } of declarations(readFileSync(path, "utf8"))) {
    const at = `${name}:${line} ${property}: ${value}`;
    if (RAW_COLOR.test(value)) {
      problems.push(`${at} (use a color token)`);
    }
    if (/radial-gradient/.test(value)) {
      problems.push(`${at} (no decorative gradients)`);
    }
    if (property.endsWith("radius") && !value.split(/\s+/).every((part) => RADIUS_VALUE.test(part))) {
      problems.push(`${at} (use --radius-sm, --radius-md, --radius-lg or --radius-full)`);
    }
    if (property === "font-weight" && !WEIGHT_VALUE.test(value)) {
      problems.push(`${at} (use --weight-regular, --weight-medium or --weight-strong)`);
    }
    if (property === "font-size" && !FONT_SIZE_VALUE.test(value)) {
      problems.push(`${at} (use a --ui-font token)`);
    }
    if (property === "box-shadow" && !/^(?:none|var\(--shadow-[a-z]+\)|inset .*var\(--[a-z-]+\).*)$/.test(value)) {
      problems.push(`${at} (use --shadow-overlay, --shadow-dialog or an inset token outline)`);
    }
    if (property === "text-transform" && value === "uppercase") {
      problems.push(`${at} (no uppercase eyebrow labels)`);
    }
  }
  return problems;
}

describe("component stylesheets", () => {
  const stylesheets = [
    ...moduleStylesheets(join(SOURCE_ROOT, "inspection")),
    ...moduleStylesheets(join(SOURCE_ROOT, "remote")),
  ];

  it("finds the component stylesheets", () => {
    expect(stylesheets.length).toBeGreaterThan(30);
  });

  it("use only design tokens for color, radius, weight, size and shadow", () => {
    expect(stylesheets.flatMap(violations)).toEqual([]);
  });
});
