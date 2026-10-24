import {
  type StandaloneValidateFunction,
  validateApiErrorEnvelope,
  validateApiHello,
  validateApplicationServerFrame,
  validateChooseDownloadRootResponse,
  validateMediaUrlResponse,
  validateOpenViewSetResponse,
  validateResponseEnvelope,
  validateUpdateBatch,
} from "./generated/v1.validators.js";
import { validateCommand } from "./generated/v1.client-validators.js";

const validators = new Map<string, StandaloneValidateFunction>([
  ["ApiHello", validateApiHello],
  ["ApplicationServerFrame", validateApplicationServerFrame],
  ["ResponseEnvelope", validateResponseEnvelope],
  ["ApiErrorEnvelope", validateApiErrorEnvelope],
  ["ChooseDownloadRootResponse", validateChooseDownloadRootResponse],
  ["Command", validateCommand],
  ["MediaUrlResponse", validateMediaUrlResponse],
  ["OpenViewSetResponse", validateOpenViewSetResponse],
  ["UpdateBatch", validateUpdateBatch],
]);

export class SchemaError extends Error {}

export function assertApiSchema<T>(
  definition: string,
  value: unknown,
): asserts value is T {
  const validator = validators.get(definition);
  if (validator === undefined) {
    throw new SchemaError(`generated schema ${definition} is unavailable`);
  }
  if (!validator(value)) {
    const detail = errorsText(validator.errors);
    throw new SchemaError(`${definition} failed schema validation: ${detail}`);
  }
}

function errorsText(errors: StandaloneValidateFunction["errors"]): string {
  if (errors === undefined || errors === null || errors.length === 0) {
    return "No errors";
  }
  return errors
    .map((error) => `data${error.instancePath} ${error.message}`)
    .join("; ");
}
