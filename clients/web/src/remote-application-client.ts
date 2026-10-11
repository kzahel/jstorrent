import type {
  ApiHello,
  ChooseDownloadRootRequest,
  OpenViewSetRequest,
  OpenViewSetResponse,
  RequestEnvelope,
  ResponseEnvelope,
  UpdateBatch,
  UpdateViewSetRequest,
} from "./api";
import {
  ApplicationViewError,
  type ApplicationUpdateStream,
  type ApplicationViewClient,
} from "./api/client";

/** Remote catalog inspection, with platform/file-URL methods excluded. */
export class RemoteOnlyApplicationClient implements ApplicationViewClient {
  public constructor(private readonly client: ApplicationViewClient) {}

  public async hello(signal?: AbortSignal): Promise<ApiHello> {
    return this.client.hello(signal);
  }

  public dispatch(
    request: RequestEnvelope,
    signal?: AbortSignal,
  ): Promise<ResponseEnvelope> {
    return this.client.dispatch(request, signal);
  }

  public chooseDownloadRoot(
    _request: ChooseDownloadRootRequest,
    _signal?: AbortSignal,
  ): Promise<never> {
    return Promise.reject(
      new ApplicationViewError(
        "unsupported_remote_capability",
        "Folder selection is unavailable through remote access",
      ),
    );
  }

  public openViewSet(
    request: OpenViewSetRequest,
    signal?: AbortSignal,
  ): Promise<OpenViewSetResponse> {
    return this.client.openViewSet(request, signal);
  }

  public updateViewSet(
    viewSetId: string,
    request: UpdateViewSetRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.client.updateViewSet(viewSetId, request, signal);
  }

  public nextUpdates(
    viewSetId: string,
    after: string,
    waitMillis: number,
    signal?: AbortSignal,
  ): Promise<UpdateBatch> {
    const updates = this.client.nextUpdates;
    if (updates === undefined) {
      return Promise.reject(new Error("polling updates are unavailable"));
    }
    return updates.call(this.client, viewSetId, after, waitMillis, signal);
  }

  public streamUpdates(
    viewSetId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<ApplicationUpdateStream> {
    const stream = this.client.streamUpdates;
    if (stream === undefined) {
      return Promise.reject(new Error("streaming updates are unavailable"));
    }
    return stream.call(this.client, viewSetId, after, signal);
  }

  public closeViewSet(viewSetId: string, signal?: AbortSignal): Promise<void> {
    return this.client.closeViewSet(viewSetId, signal);
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}
