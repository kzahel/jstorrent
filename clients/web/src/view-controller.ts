import type {
  OpenViewSetRequest,
  RequestEnvelope,
  ResponseEnvelope,
  UpdateBatch,
  UpdateViewSetRequest,
  ViewSpec,
} from "./api";
import {
  ApplicationViewError,
  type ApplicationUpdateStream,
  type ApplicationViewClient,
} from "./api/client";
import {
  reduceOpenViewSet,
  reduceUpdateBatch,
  ViewSetContinuityError,
  type ViewSetState,
} from "./view-set-reducer";
import { ContractError } from "./validation";

export interface ViewControllerOptions {
  waitMillis?: number;
  retryBaseMillis?: number;
  retryMaximumMillis?: number;
}

export type ViewStateListener = (state: ViewSetState) => void;
export type ViewErrorListener = (error: Error) => void;
export type ViewStatusListener = (status: ViewConnectionStatus) => void;

// Why delivery stopped for good: retrying cannot help, only a reload can.
export type ViewStopReason = "signed_out" | "reload_required";

// Times are wall-clock milliseconds. `nextAttemptAt` is null while an
// attempt is in progress.
export type ViewConnectionStatus =
  | { readonly type: "connected" }
  | {
      readonly type: "retrying";
      readonly since: number;
      readonly nextAttemptAt: number | null;
    }
  | { readonly type: "stopped"; readonly reason: ViewStopReason };

export class ViewController {
  private readonly waitMillis: number;
  private readonly retryBaseMillis: number;
  private readonly retryMaximumMillis: number;
  private state: ViewSetState;
  private inFlight: AbortController | undefined;
  private activeStream: ApplicationUpdateStream | undefined;
  private consuming: Promise<void> | undefined;
  private reopening: Promise<void> | undefined;
  private retryWake: AbortController | undefined;
  private disconnectedSince: number | null = null;
  private readonly lifetime = new AbortController();
  private closed = false;
  private views: ViewSpec[];

  private constructor(
    private readonly client: ApplicationViewClient,
    initial: ViewSetState,
    private readonly onState: ViewStateListener,
    private readonly onError: ViewErrorListener,
    private readonly onStatus: ViewStatusListener,
    options: ViewControllerOptions,
    views: ViewSpec[],
  ) {
    this.state = initial;
    this.waitMillis = options.waitMillis ?? 20_000;
    this.retryBaseMillis = options.retryBaseMillis ?? 250;
    // Fast at first so brief blips recover quietly, then slow enough that a
    // visible countdown means something.
    this.retryMaximumMillis = options.retryMaximumMillis ?? 30_000;
    this.views = [...views];
  }

  public static async open(
    client: ApplicationViewClient,
    views: ViewSpec[],
    onState: ViewStateListener,
    onError: ViewErrorListener = () => {},
    options: ViewControllerOptions = {},
    onStatus: ViewStatusListener = () => {},
  ): Promise<ViewController> {
    const request: OpenViewSetRequest = { views, options: {} };
    const response = await client.openViewSet(request);
    const initial = reduceOpenViewSet(response);
    const controller = new ViewController(
      client,
      initial,
      onState,
      onError,
      onStatus,
      options,
      views,
    );
    try {
      onState(initial);
    } catch (error) {
      await client.closeViewSet(response.view_set_id);
      throw error;
    }
    controller.consuming = controller.consume();
    return controller;
  }

  public current(): ViewSetState {
    return this.state;
  }

  public async dispatch(request: RequestEnvelope): Promise<ResponseEnvelope> {
    this.ensureOpen();
    const response = await this.client.dispatch(request, this.lifetime.signal);
    this.wake();
    return response;
  }

  public async setViews(views: ViewSpec[]): Promise<void> {
    this.ensureOpen();
    this.views = [...views];
    const request: UpdateViewSetRequest = { views: this.views };
    try {
      await this.client.updateViewSet(
        this.state.viewSetId,
        request,
        this.lifetime.signal,
      );
    } catch (error) {
      const failure = asError(error);
      if (!isUnavailableViewSet(failure)) throw failure;
      this.onError(failure);
      await this.reopen();
    }
    this.wake();
  }

  // Polls now, and skips any pending reconnect delay.
  public requestImmediatePoll(): void {
    this.ensureOpen();
    this.wake();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort("view controller closed");
    this.inFlight?.abort("view controller closed");
    await this.activeStream?.close().catch(() => {});
    await this.consuming;
    await this.reopening?.catch(() => {});
    try {
      await this.client.closeViewSet(this.state.viewSetId);
    } catch (error) {
      if (!isUnavailableViewSet(asError(error))) throw error;
    }
  }

  private async consume(): Promise<void> {
    let retryMillis = this.retryBaseMillis;
    while (!this.closed) {
      try {
        if (this.client.streamUpdates === undefined) {
          await this.pullOnce();
        } else {
          const streamingViewSet = this.state.viewSetId;
          await this.streamOnce();
          if (!this.closed && this.state.viewSetId === streamingViewSet) {
            throw new Error("application update stream closed");
          }
        }
        retryMillis = this.retryBaseMillis;
      } catch (error) {
        if (this.closed || this.lifetime.signal.aborted) continue;
        let failure = asError(error);
        this.onError(failure);
        this.markDisconnected();
        if (isUnavailableViewSet(failure)) {
          try {
            await this.reopen();
            retryMillis = this.retryBaseMillis;
            continue;
          } catch (reopenError) {
            if (this.closed || this.lifetime.signal.aborted) continue;
            failure = asError(reopenError);
            this.onError(failure);
          }
        }
        const stopReason = viewStopReason(failure);
        if (stopReason !== null) {
          this.onStatus({ type: "stopped", reason: stopReason });
          break;
        }
        await this.waitBeforeRetry(retryMillis);
        retryMillis = Math.min(retryMillis * 2, this.retryMaximumMillis);
      }
    }
  }

  private async waitBeforeRetry(millis: number): Promise<void> {
    const since = this.disconnectedSince ?? Date.now();
    const wake = new AbortController();
    this.retryWake = wake;
    this.onStatus({ type: "retrying", since, nextAttemptAt: Date.now() + millis });
    try {
      await abortableDelay(millis, this.lifetime.signal, wake.signal);
    } finally {
      if (this.retryWake === wake) this.retryWake = undefined;
    }
    if (this.closed) return;
    this.onStatus({ type: "retrying", since, nextAttemptAt: null });
  }

  private markDisconnected(): void {
    if (this.disconnectedSince !== null) return;
    this.disconnectedSince = Date.now();
    this.onStatus({
      type: "retrying",
      since: this.disconnectedSince,
      nextAttemptAt: null,
    });
  }

  private markConnected(): void {
    if (this.disconnectedSince === null) return;
    this.disconnectedSince = null;
    this.onStatus({ type: "connected" });
  }

  private async pullOnce(): Promise<void> {
    const nextUpdates = this.client.nextUpdates;
    if (nextUpdates === undefined) {
      throw new Error("application client has no update delivery mechanism");
    }
    const request = new AbortController();
    this.inFlight = request;
    try {
      let batch: UpdateBatch;
      try {
        batch = await nextUpdates.call(
          this.client,
          this.state.viewSetId,
          this.state.cursor,
          this.waitMillis,
          request.signal,
        );
      } catch (error) {
        if (request.signal.aborted) return;
        throw error;
      }
      if (request.signal.aborted) return;
      this.markConnected();
      this.applyBatch(batch);
    } finally {
      if (this.inFlight === request) this.inFlight = undefined;
    }
  }

  private async streamOnce(): Promise<void> {
    const openStream = this.client.streamUpdates;
    if (openStream === undefined) {
      throw new Error("application client has no streaming delivery");
    }
    const stream = await openStream.call(
      this.client,
      this.state.viewSetId,
      this.state.cursor,
      this.lifetime.signal,
    );
    this.activeStream = stream;
    this.markConnected();
    try {
      for await (const batch of stream) {
        if (this.closed) break;
        this.applyBatch(batch);
      }
    } finally {
      if (this.activeStream === stream) this.activeStream = undefined;
      await stream.close().catch(() => {});
    }
  }

  private applyBatch(batch: UpdateBatch): void {
    const next = reduceUpdateBatch(this.state, batch);
    if (next === this.state) return;
    this.onState(next);
    this.state = next;
  }

  private wake(): void {
    this.inFlight?.abort("immediate poll requested");
    this.retryWake?.abort("immediate poll requested");
  }

  private async reopen(): Promise<void> {
    if (this.reopening !== undefined) return this.reopening;
    const reopening = (async () => {
      this.inFlight?.abort("reopening view set");
      await this.activeStream?.close().catch(() => {});
      const response = await this.client.openViewSet(
        { views: this.views, options: {} },
        this.lifetime.signal,
      );
      const next = reduceOpenViewSet(response);
      try {
        this.onState(next);
      } catch (error) {
        await this.client.closeViewSet(
          response.view_set_id,
          this.lifetime.signal,
        );
        throw error;
      }
      this.state = next;
      this.markConnected();
    })();
    this.reopening = reopening;
    try {
      await reopening;
    } finally {
      if (this.reopening === reopening) this.reopening = undefined;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("view controller is closed");
  }
}

function isUnavailableViewSet(error: Error): boolean {
  return (
    error instanceof ApplicationViewError &&
    (error.code === "unknown_view_set" || error.code === "view_set_closed")
  );
}

function viewStopReason(error: Error): ViewStopReason | null {
  if (
    error instanceof ContractError ||
    error instanceof ViewSetContinuityError
  ) {
    return "reload_required";
  }
  if (error instanceof ApplicationViewError) {
    if (error.code === "authentication_failed") return "signed_out";
    if (error.code === "invalid_version") return "reload_required";
  }
  return null;
}

function abortableDelay(
  millis: number,
  ...signals: AbortSignal[]
): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((signal) => signal.aborted)) {
      resolve();
      return;
    }
    const finish = () => {
      globalThis.clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = globalThis.setTimeout(finish, millis);
    for (const signal of signals) {
      signal.addEventListener("abort", finish, { once: true });
    }
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
