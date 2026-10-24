// Tactical 352: failure types and bounds the application shell needs before
// the transports and generated validators load. `client.ts`, `validation.ts`
// and `view-set-reducer.ts` re-export them.

/** A response or frame that does not satisfy the application contract. */
export class ContractError extends Error {}

/** An update batch that cannot continue the current view set. */
export class ViewSetContinuityError extends Error {}

export class ApplicationViewError extends Error {
  public constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

export class HttpApiError extends ApplicationViewError {
  public constructor(
    public readonly status: number,
    code: string,
    message: string,
  ) {
    super(code, message);
  }
}

/** Tactical 348: the engine's bundle bound, in both directions. */
export const MAX_TORRENT_LIST_BUNDLE_BYTES = 256 * 1024 * 1024;
