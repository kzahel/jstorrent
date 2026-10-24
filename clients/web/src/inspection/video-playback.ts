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
  /** A capability URL for the file on this page's origin, for `<audio>`. */
  mediaUrl(file: VideoFile, signal?: AbortSignal): Promise<string>;
}

/** Audio the browser plays natively from a range-capable URL. */
const AUDIO_FILE = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav)$/i;

export function isAudioFile(name: string): boolean {
  return AUDIO_FILE.test(name);
}

export function canPlayRemoteFile(name: string, availability: string): boolean {
  return availability === "available" && /\.(mp4|m4v)$/i.test(name);
}

export function canPlayLocalFile(name: string, availability: string): boolean {
  return (
    availability === "available" &&
    (/\.(mp4|m4v|mkv)$/i.test(name) || isAudioFile(name))
  );
}
