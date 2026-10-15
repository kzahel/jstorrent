/**
 * Removes reviewed strict-client exposures from a host frame, guided by the
 * current schema, so a released strict client's failure can be attributed
 * to them. Attribution only: the raw frame stays incompatible
 * (docs/tactical/359-mixed-version-compatibility-matrix.md).
 *
 * Exposure keys use the contract comparison's paths: `Definition.property`,
 * nested `Definition.property.child`, and branches as
 * `Definition.oneOf[tag=value]`.
 */
type Schema = {
  readonly $ref?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly items?: Schema;
  readonly additionalProperties?: boolean | Schema;
  readonly oneOf?: readonly Schema[];
  readonly anyOf?: readonly Schema[];
  readonly const?: unknown;
  readonly type?: unknown;
};

export interface ContractSchema {
  readonly $defs: Readonly<Record<string, Schema>>;
}

export function stripExposures(
  value: unknown,
  definition: string,
  contract: ContractSchema,
  exposures: ReadonlySet<string>,
): unknown {
  const copy = structuredClone(value);
  walk(copy, { $ref: `#/$defs/${definition}` }, definition, contract, exposures);
  return copy;
}

function walk(
  value: unknown,
  schema: Schema,
  path: string,
  contract: ContractSchema,
  exposures: ReadonlySet<string>,
): void {
  if (schema.$ref !== undefined) {
    const name = schema.$ref.split("/").at(-1)!;
    const target = contract.$defs[name];
    if (target !== undefined) walk(value, target, name, contract, exposures);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const union = schema.oneOf ?? schema.anyOf;
  if (union !== undefined) {
    const match = branch(value, union, path);
    if (match !== null) walk(value, match.schema, match.path, contract, exposures);
    return;
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    if (items === undefined) return;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      if (exposedBranch(value[index], items, contract, exposures)) {
        value.splice(index, 1);
      } else {
        walk(value[index], items, `${path}.items`, contract, exposures);
      }
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const property = schema.properties?.[key];
    if (exposures.has(`${path}.${key}`)) {
      delete record[key];
    } else if (property !== undefined) {
      walk(record[key], property, `${path}.${key}`, contract, exposures);
    } else if (typeof schema.additionalProperties === "object") {
      walk(record[key], schema.additionalProperties, `${path}.additionalProperties`, contract, exposures);
    }
  }
}

/** Whether an array item is a tagged branch that is itself an exposure. */
function exposedBranch(
  value: unknown,
  schema: Schema,
  contract: ContractSchema,
  exposures: ReadonlySet<string>,
): boolean {
  if (schema.$ref === undefined) return false;
  const name = schema.$ref.split("/").at(-1)!;
  const union = contract.$defs[name]?.oneOf ?? contract.$defs[name]?.anyOf;
  if (union === undefined || value === null || typeof value !== "object") return false;
  const tag = discriminator(value as Record<string, unknown>, union);
  return tag !== null && exposures.has(`${name}.oneOf[${tag}]`);
}

function branch(
  value: object,
  union: readonly Schema[],
  path: string,
): { schema: Schema; path: string } | null {
  if (Array.isArray(value)) return null;
  const tag = discriminator(value as Record<string, unknown>, union);
  if (tag !== null) {
    const schema = union.find((candidate) => branchTag(candidate) === tag)!;
    return { schema, path: `${path}.oneOf[${tag}]` };
  }
  // A nullable reference (`anyOf: [ref, null]`) or one untagged object branch.
  const objects = union.filter((candidate) => candidate.type !== "null");
  if (objects.length === 1) return { schema: objects[0]!, path };
  return null;
}

function discriminator(value: Record<string, unknown>, union: readonly Schema[]): string | null {
  for (const candidate of union) {
    const tag = branchTag(candidate);
    if (tag === null) continue;
    const [key, constant] = tag.split("=") as [string, string];
    if (String(value[key]) === constant) return tag;
  }
  return null;
}

function branchTag(schema: Schema): string | null {
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (property.const !== undefined) return `${key}=${String(property.const)}`;
  }
  return null;
}
