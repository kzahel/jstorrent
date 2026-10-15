import { describe, expect, it } from "vitest";

import current from "./generated/v1.schema.json";
import { HOST_CAPABILITY_REGISTRY } from "./generated/v1";
import releaseCompatibility from "./release-compatibility.json";
import released031 from "../fixtures/released/desktop-v0.3.1/v1.schema.json";

/**
 * The application contract against every released host's contract. Rules
 * and runbook: docs/topics/mixed-version-compatibility.md.
 *
 * - Nothing released may be removed, renamed or made required.
 * - A new key the client sends must be owned by a host capability, because a
 *   released host rejects it.
 * - A new field, enum value or variant inside a type that released strict
 *   clients validate strictly breaks those clients when a host sends it.
 *   Each one is recorded in release-compatibility.json, which also gates host
 *   releases while strict clients are supported.
 */
const REVIEWED_STRICT_CLIENT_EXPOSURE: Readonly<Record<string, string>> =
  releaseCompatibility.reviewedStrictClientExposure;

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
  readonly items?: Schema;
  readonly [keyword: string]: unknown;
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
    // A released host's command parser ignores unknown fields, so a new
    // field in an existing command would be silently dropped there.
    const commandFields = new Set(
      HOST_CAPABILITY_REGISTRY.flatMap((capability) => capability.command_fields),
    );
    const releasedCommands = new Map(branches(before.Command));
    for (const [variant, branch] of branches(after.Command)) {
      const released = releasedCommands.get(variant);
      if (released === undefined) continue;
      const command = variant.replace(/^type=/, "");
      for (const field of addedProperties(released, branch)) {
        if (!commandFields.has(`${command}.${field}`)) {
          problems.push(`Command ${command}.${field} has no capability`);
        }
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

describe("schema comparison", () => {
  const released: Schema = {
    type: "object",
    additionalProperties: false,
    required: ["limits"],
    properties: {
      limits: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "integer", minimum: 0 },
          mode: { enum: ["off", "on"] },
          items: { type: "array", items: { type: "string" } },
        },
      },
      choice: {
        oneOf: [
          { type: "object", properties: { type: { const: "a" }, value: { type: "string" } } },
          { type: "object", properties: { type: { const: "b" } } },
        ],
      },
    },
  };

  it("finds nested breaking changes", () => {
    const current = structuredClone(released) as {
      properties: Record<string, { properties?: Record<string, Schema>; oneOf?: Schema[] }>;
    };
    current.properties.limits!.properties!.count = { type: "integer", minimum: 1 };
    current.properties.limits!.properties!.items = { type: "array", items: { type: "integer" } };
    delete current.properties.limits!.properties!.mode;
    current.properties.choice!.oneOf![0] = {
      type: "object",
      properties: { type: { const: "a" }, value: { type: "number" } },
    };
    expect(compareSchemas("T", released, current as Schema).breaking.sort()).toEqual([
      "T.choice.oneOf[type=a].value type changed from \"string\" to \"number\"",
      "T.limits.count minimum changed from 0 to 1",
      "T.limits.items.items type changed from \"string\" to \"integer\"",
      "T.limits.mode removed",
    ]);
  });

  it("finds nested additions strict clients reject", () => {
    const current = structuredClone(released) as {
      properties: Record<string, { properties?: Record<string, Schema>; oneOf?: Schema[] }>;
    };
    current.properties.limits!.properties!.added = { type: "boolean" };
    current.properties.limits!.properties!.mode = { enum: ["off", "on", "auto"] };
    current.properties.choice!.oneOf!.push({ type: "object", properties: { type: { const: "c" } } });
    const result = compareSchemas("T", released, current as Schema);
    expect(result.breaking).toEqual([]);
    expect(result.exposures.sort()).toEqual([
      "T.choice.oneOf[type=c]",
      "T.limits.added",
      'T.limits.mode.enum["auto"]',
    ]);
  });
});

function breakingChanges(name: string, old: Schema, next: Schema): string[] {
  return compareSchemas(name, old, next).breaking;
}

function strictClientExposure(name: string, old: Schema, next: Schema): string[] {
  return compareSchemas(name, old, next).exposures;
}

/** Keywords whose change alters what a value may be. */
const CONSTRAINTS = [
  "type",
  "format",
  "const",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
] as const;

/**
 * Walks a released schema and the current one together: properties, array
 * items, map values and tagged branches. Removing, retyping, re-pointing or
 * newly requiring anything is breaking. Adding a property to a closed
 * object, an enum value or a branch is something released strict clients
 * reject, so it is an exposure.
 */
function compareSchemas(
  path: string,
  old: Schema,
  next: Schema,
  result: { breaking: string[]; exposures: string[] } = { breaking: [], exposures: [] },
): { breaking: string[]; exposures: string[] } {
  if (old.$ref !== undefined || next.$ref !== undefined) {
    // Referenced definitions are compared once, under their own names.
    if (old.$ref !== next.$ref) {
      result.breaking.push(`${path} changed from ${String(old.$ref)} to ${String(next.$ref)}`);
    }
    return result;
  }
  for (const keyword of CONSTRAINTS) {
    if (JSON.stringify(old[keyword]) !== JSON.stringify(next[keyword])) {
      result.breaking.push(
        `${path} ${keyword} changed from ${JSON.stringify(old[keyword])} to ${JSON.stringify(next[keyword])}`,
      );
    }
  }
  for (const value of old.enum ?? []) {
    if (!(next.enum ?? []).includes(value)) {
      result.breaking.push(`${path} enum value ${JSON.stringify(value)} removed`);
    }
  }
  for (const value of next.enum ?? []) {
    if (old.enum !== undefined && !old.enum.includes(value)) {
      result.exposures.push(`${path}.enum[${JSON.stringify(value)}]`);
    }
  }
  const required = new Set(old.required ?? []);
  for (const key of next.required ?? []) {
    if (!required.has(key)) result.breaking.push(`${path}.${key} newly required`);
  }
  for (const [key, property] of Object.entries(old.properties ?? {})) {
    const current = next.properties?.[key];
    if (current === undefined) {
      result.breaking.push(`${path}.${key} removed`);
    } else {
      compareSchemas(`${path}.${key}`, property, current, result);
    }
  }
  if (old.additionalProperties === false) {
    for (const key of addedProperties(old, next)) result.exposures.push(`${path}.${key}`);
  }
  for (const keyword of ["items", "additionalProperties"] as const) {
    const before = old[keyword];
    const after = next[keyword];
    if (typeof before === "object" && typeof after === "object") {
      compareSchemas(`${path}.${keyword}`, before, after, result);
    }
  }
  const branchesBefore = new Map(branches(old));
  const branchesAfter = new Map(branches(next));
  for (const [variant, branch] of branchesBefore) {
    const current = branchesAfter.get(variant);
    if (current === undefined) {
      result.breaking.push(`${path} variant ${variant} removed`);
    } else {
      compareSchemas(`${path}.oneOf[${variant}]`, branch, current, result);
    }
  }
  for (const variant of branchesAfter.keys()) {
    if (!branchesBefore.has(variant)) result.exposures.push(`${path}.oneOf[${variant}]`);
  }
  return result;
}

function branches(schema: Schema | undefined): [string, Schema][] {
  const all = [...(schema?.oneOf ?? []), ...(schema?.anyOf ?? [])];
  const keys = variants(schema);
  return all.map((branch, index) => [keys[index]!, branch]);
}

function addedProperties(old: Schema | undefined, next: Schema | undefined): string[] {
  const before = new Set(Object.keys(old?.properties ?? {}));
  return Object.keys(next?.properties ?? {}).filter((key) => !before.has(key));
}

function addedVariants(old: Schema | undefined, next: Schema | undefined): string[] {
  const before = new Set(variants(old));
  return variants(next).filter((variant) => !before.has(variant));
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
