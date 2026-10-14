import { describe, expect, it } from "vitest";

import current from "./generated/v1.schema.json";
import { HOST_CAPABILITY_REGISTRY } from "./generated/v1";
import released031 from "../fixtures/released/desktop-v0.3.1/v1.schema.json";

/**
 * The application contract against every released host's contract. Rules
 * and runbook: docs/topics/mixed-version-compatibility.md.
 *
 * - Nothing released may be removed, renamed or made required.
 * - A new key the client sends must be owned by a host capability, because a
 *   released host rejects it.
 * - A new field, enum value or variant inside a type that released clients
 *   validate strictly breaks those clients when a host sends it. Each one is
 *   recorded here with how it is made safe before a host release ships it.
 */
const REVIEWED_STRICT_CLIENT_EXPOSURE: Readonly<Record<string, string>> = {
  "ClientSettings.seed_stop_ratio_percent":
    "seed_stop_limits; hosts may ship it once tolerant clients are out (354 release order)",
  "ClientSettings.seed_stop_time_seconds":
    "seed_stop_limits; hosts may ship it once tolerant clients are out (354 release order)",
  "TorrentSeedingView.stop":
    "seed_stop_limits; hosts may ship it once tolerant clients are out (354 release order)",
  "TorrentFieldUpdate.oneOf[field=private_torrent]":
    "row delta for TorrentView.private_torrent; needs tolerant clients before a host release",
  "TorrentFieldUpdate.oneOf[field=source_size_bytes]":
    "row delta for the source size; needs tolerant clients before a host release",
};

const RELEASED = [{ tag: "desktop-v0.3.1", schema: released031 }];

/** Types a client builds and a host parses with unknown keys rejected. */
const CLIENT_SENT_PATCHES = {
  ClientSettingsPatch: "client_settings_patch_keys",
  TorrentSettingsPatch: "torrent_settings_patch_keys",
} as const;

type Schema = {
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Schema;
  readonly enum?: readonly unknown[];
  readonly oneOf?: readonly Schema[];
  readonly anyOf?: readonly Schema[];
  readonly const?: unknown;
  readonly $ref?: string;
  readonly type?: unknown;
};
type Definitions = Readonly<Record<string, Schema>>;

describe.each(RELEASED)("contract against $tag", ({ schema }) => {
  const before = (schema as { $defs: Definitions }).$defs;
  const after = (current as { $defs: Definitions }).$defs;

  it("removes, renames or newly requires nothing", () => {
    const problems: string[] = [];
    for (const [name, old] of Object.entries(before)) {
      const next = after[name];
      if (next === undefined) {
        problems.push(`${name}: definition removed`);
        continue;
      }
      problems.push(...breakingChanges(name, old, next));
    }
    expect(problems).toEqual([]);
  });

  it("gates every new client-sent key on a host capability", () => {
    const problems: string[] = [];
    for (const [name, registryKey] of Object.entries(CLIENT_SENT_PATCHES)) {
      const owned = new Set(
        HOST_CAPABILITY_REGISTRY.flatMap((capability) => capability[registryKey]),
      );
      for (const key of addedProperties(before[name], after[name])) {
        if (!owned.has(key)) problems.push(`${name}.${key} has no capability`);
      }
    }
    const commands = new Set(
      HOST_CAPABILITY_REGISTRY.flatMap((capability) => capability.commands),
    );
    for (const variant of addedVariants(before.Command, after.Command)) {
      if (!commands.has(variant.replace(/^type=/, ""))) {
        problems.push(`Command ${variant} has no capability`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("records every addition released strict clients would reject", () => {
    const exposures: string[] = [];
    for (const [name, old] of Object.entries(before)) {
      const next = after[name];
      if (next === undefined || name in CLIENT_SENT_PATCHES || name === "Command") continue;
      exposures.push(...strictClientExposure(name, old, next));
    }
    expect(exposures.sort()).toEqual(
      Object.keys(REVIEWED_STRICT_CLIENT_EXPOSURE).sort(),
    );
  });
});

function breakingChanges(name: string, old: Schema, next: Schema): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(old.properties ?? {})) {
    if (next.properties?.[key] === undefined) problems.push(`${name}.${key} removed`);
  }
  const required = new Set(old.required ?? []);
  for (const key of next.required ?? []) {
    if (!required.has(key)) problems.push(`${name}.${key} newly required`);
  }
  for (const value of old.enum ?? []) {
    if (!(next.enum ?? []).includes(value)) {
      problems.push(`${name} enum value ${JSON.stringify(value)} removed`);
    }
  }
  for (const variant of removedVariants(old, next)) {
    problems.push(`${name} variant ${variant} removed`);
  }
  return problems;
}

function strictClientExposure(name: string, old: Schema, next: Schema): string[] {
  const exposures: string[] = [];
  if (old.additionalProperties === false) {
    for (const key of addedProperties(old, next)) exposures.push(`${name}.${key}`);
  }
  for (const value of next.enum ?? []) {
    if (old.enum !== undefined && !old.enum.includes(value)) {
      exposures.push(`${name}.enum[${JSON.stringify(value)}]`);
    }
  }
  for (const variant of addedVariants(old, next)) {
    exposures.push(`${name}.oneOf[${variant}]`);
  }
  return exposures;
}

function addedProperties(old: Schema | undefined, next: Schema | undefined): string[] {
  const before = new Set(Object.keys(old?.properties ?? {}));
  return Object.keys(next?.properties ?? {}).filter((key) => !before.has(key));
}

function addedVariants(old: Schema | undefined, next: Schema | undefined): string[] {
  const before = new Set(variants(old));
  return variants(next).filter((variant) => !before.has(variant));
}

function removedVariants(old: Schema, next: Schema): string[] {
  const after = new Set(variants(next));
  return variants(old).filter((variant) => !after.has(variant));
}

/** A stable identity for each tagged branch: its discriminator constant. */
function variants(schema: Schema | undefined): string[] {
  return [...(schema?.oneOf ?? []), ...(schema?.anyOf ?? [])].map((branch) => {
    for (const [key, property] of Object.entries(branch.properties ?? {})) {
      if (property.const !== undefined) return `${key}=${String(property.const)}`;
    }
    if (branch.const !== undefined) return `const=${JSON.stringify(branch.const)}`;
    if (branch.enum !== undefined) return `enum=${JSON.stringify(branch.enum)}`;
    if (branch.$ref !== undefined) return branch.$ref;
    if (branch.type === "null") return "null";
    const keys = Object.keys(branch.properties ?? {});
    if (keys.length === 1) return `key=${keys[0]}`;
    return JSON.stringify(branch);
  });
}
