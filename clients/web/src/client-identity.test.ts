import { afterEach, describe, expect, it, vi } from "vitest";

import { version } from "../package.json";
import { clientIdentity, extensionVersion } from "./client-identity";

afterEach(() => vi.unstubAllGlobals());

describe("client identity", () => {
  it("defaults to the web package version and a development build", () => {
    expect(clientIdentity("web")).toEqual({ kind: "web", version, build_id: "development" });
  });

  it("keeps a valid version and build and drops what a host would reject", () => {
    expect(clientIdentity("remote", { buildId: "0123abcd" }).build_id).toBe("0123abcd");
    expect(clientIdentity("extension", { version: "1.1.6" }).version).toBe("1.1.6");
    expect(clientIdentity("remote", { buildId: "with space" }).build_id).toBe("development");
    expect(clientIdentity("extension", { version: "1".repeat(33) }).version).toBe(version);
  });

  it("reads the extension manifest version when available", () => {
    expect(extensionVersion()).toBeUndefined();
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.1.6" }) } });
    expect(extensionVersion()).toBe("1.1.6");
  });
});
