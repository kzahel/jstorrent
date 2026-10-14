// @vitest-environment node

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const BOOT_SCRIPT = readFileSync(
  new URL("../public/rstorrent-boot.js", import.meta.url),
  "utf8",
);

interface BootRun {
  readonly attributes: Record<string, string>;
  readonly colorScheme: string;
  readonly marks: string[];
}

function runBootScript(stored: string | null): BootRun {
  const attributes: Record<string, string> = {};
  let colorScheme = "light dark";
  const marks: string[] = [];
  const window = {
    performance: { mark: (name: string) => marks.push(name) },
    localStorage: { getItem: () => stored },
    addEventListener: () => {},
    setTimeout: () => 0,
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    },
    querySelector: () => ({
      setAttribute: (_name: string, value: string) => {
        colorScheme = value;
      },
    }),
    getElementById: () => null,
  };
  runInNewContext(BOOT_SCRIPT, { window, document, JSON });
  return { attributes, colorScheme, marks };
}

describe("production boot shell", () => {
  it("loads a classic failure guard before the application module", () => {
    const document = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const guard = '<script src="/rstorrent-boot.js"></script>';
    const application = '<script type="module" src="/src/main.ts"></script>';

    expect(document).toContain(guard);
    expect(document).toContain('id="rstorrent-boot-status"');
    expect(document).toContain("JSTorrent requires JavaScript in this browser.");
    expect(document.indexOf(guard)).toBeLessThan(document.indexOf(application));
  });

  it("keeps the failure guard compatible with browsers that cannot run modules", () => {
    expect(BOOT_SCRIPT).toContain('window.addEventListener("error", showFailure)');
    expect(BOOT_SCRIPT).toContain("window.setTimeout(showFailure, 10000)");
    expect(BOOT_SCRIPT).not.toMatch(/(?:=>|\bconst\b|\blet\b|\?\.|\?\?)/);
  });

  it("applies the stored theme and size before the bundle loads", () => {
    const run = runBootScript(
      JSON.stringify({ version: 3, colorTheme: "dark", interfaceSize: "compact" }),
    );
    expect(run.attributes).toEqual({
      "data-color-theme": "dark",
      "data-interface-size": "compact",
    });
    expect(run.colorScheme).toBe("dark");
    expect(run.marks).toEqual(["jstorrent:startup:boot"]);
  });

  it("ignores missing, malformed, other-version and hostile preferences", () => {
    for (const stored of [
      null,
      "{",
      JSON.stringify({ version: 2, colorTheme: "dark" }),
      JSON.stringify({ version: 3, colorTheme: "url(x)", interfaceSize: "toString" }),
    ]) {
      expect(runBootScript(stored).attributes).toEqual({});
    }
  });

  it("mirrors the application's appearance storage key and version", () => {
    const appearance = readFileSync(
      new URL("./inspection/appearance.ts", import.meta.url),
      "utf8",
    );
    const key = /APPEARANCE_STORAGE_KEY = "([^"]+)"/.exec(appearance)?.[1];
    const version = /APPEARANCE_VERSION = (\d+)/.exec(appearance)?.[1];
    expect(BOOT_SCRIPT).toContain(`var APPEARANCE_STORAGE_KEY = "${key}"`);
    expect(BOOT_SCRIPT).toContain(`var APPEARANCE_VERSION = ${version}`);
  });

  it("boxes only failures, not loading", () => {
    const shell = readFileSync(new URL("./jstorrent-shell.css", import.meta.url), "utf8");
    expect(shell).not.toMatch(/#rstorrent-boot-status\s*[,{]/);
    expect(shell).toContain('#rstorrent-boot-status[role="alert"]');
  });
});
