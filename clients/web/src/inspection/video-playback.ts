export interface VideoFile {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly lengthBytes: string;
}

export interface VideoPlaybackRequest extends VideoFile {
  readonly video: HTMLVideoElement;
  readonly signal?: AbortSignal;
  readonly onReady?: () => void;
  readonly onError?: (message: string) => void;
}

/** In-page playback of files on the host that serves this page. */
export interface LocalVideoPlayback {
  play(request: VideoPlaybackRequest): Promise<{ close(): Promise<void> }>;
  /** Hands the file to a new tab; call directly from a user activation. */
  openExternally(file: VideoFile): Promise<void>;
}

export function canPlayRemoteFile(name: string, availability: string): boolean {
  return availability === "available" && /\.(mp4|m4v)$/i.test(name);
}

export function canPlayLocalFile(name: string, availability: string): boolean {
  return availability === "available" && /\.(mp4|m4v|mkv)$/i.test(name);
}
