import { message as localizedMessage } from "../../localization/runtime";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import type { DesktopRemoteAccess } from "../remote-access/types";
import {
  canPlayLocalFile,
  canPlayRemoteFile,
  isAudioFile,
  type LocalVideoPlayback,
  type VideoFile,
  type VideoPlaybackRequest,
} from "../video-playback";
import { Icon } from "./Icon";
import styles from "./VideoPlayer.module.css";

const PlaybackContext = createContext<{
  /** Remote sessions play only in the dialog; they have no local Open. */
  remote: boolean;
  canPlay(name: string, availability: string): boolean;
  play(file: VideoFile): void;
}>({
  remote: false,
  canPlay: () => false,
  play: () => {},
});
export const usePlayback = () => useContext(PlaybackContext);

type PlaybackSource =
  | { readonly type: "remote"; readonly remoteAccess: DesktopRemoteAccess }
  | { readonly type: "local"; readonly playback: LocalVideoPlayback };

export function PlaybackProvider({
  remoteAccess,
  localPlayback,
  children,
}: {
  readonly remoteAccess?: DesktopRemoteAccess | undefined;
  readonly localPlayback?: LocalVideoPlayback | undefined;
  readonly children: ReactNode;
}) {
  const [file, setFile] = useState<VideoFile | null>(null);
  const source = useMemo<PlaybackSource | null>(
    () =>
      remoteAccess?.scope === "remote"
        ? { type: "remote", remoteAccess }
        : localPlayback === undefined
          ? null
          : { type: "local", playback: localPlayback },
    [remoteAccess, localPlayback],
  );
  const canPlay =
    source === null
      ? () => false
      : source.type === "remote"
        ? canPlayRemoteFile
        : canPlayLocalFile;
  return (
    <PlaybackContext.Provider
      value={{ remote: source?.type === "remote", canPlay, play: setFile }}
    >
      {children}
      {source && file ? (
        <ModalOverlay
          isOpen
          isDismissable
          onOpenChange={(open) => {
            if (!open) setFile(null);
          }}
          className={styles.backdrop!}
        >
          <Modal className={styles.modal!}>
            <Dialog
              aria-label={localizedMessage("remote.video.title", {
                name: file.fileName,
              })}
              className={styles.dialog!}
            >
              <header>
                <h2>{file.fileName}</h2>
                {source.type === "local" ? (
                  <OpenExternallyButton playback={source.playback} file={file} />
                ) : null}
                <button
                  autoFocus
                  onClick={() => setFile(null)}
                  aria-label={localizedMessage("remote.video.close.label")}
                >
                  {localizedMessage("remote.video.close")}
                </button>
              </header>
              {source.type === "local" && isAudioFile(file.fileName) ? (
                <Audio
                  key={`${file.torrentId}:${file.fileIndex}`}
                  file={file}
                  playback={source.playback}
                />
              ) : (
                <Video
                  key={`${file.torrentId}:${file.fileIndex}`}
                  file={file}
                  source={source}
                />
              )}
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </PlaybackContext.Provider>
  );
}

function OpenExternallyButton({
  playback,
  file,
}: {
  readonly playback: LocalVideoPlayback;
  readonly file: VideoFile;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error === null ? null : <span role="alert">{error}</span>}
      <button
        className={styles.openExternally}
        onClick={() => {
          setError(null);
          // Called synchronously so the new tab keeps this click's activation.
          playback.openExternally(file).catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        }}
      >
        {localizedMessage("video.open.new.tab")}
        <Icon name="openExternal" />
      </button>
    </>
  );
}

/** The browser decodes audio itself from the media URL's ranges. */
type PlaybackStatusCode = "loading" | "connecting" | "ready" | "playing" | "buffering" | "unsupported" | "decode-error";
type PlaybackStatus = PlaybackStatusCode | { readonly error: string };
function statusText(status: PlaybackStatus): string {
  if (typeof status !== "string") return status.error;
  switch (status) {
    case "loading": return localizedMessage("video.loading");
    case "connecting": return localizedMessage("remote.video.connecting");
    case "ready": return localizedMessage("remote.video.ready");
    case "playing": return localizedMessage("remote.video.playing");
    case "buffering": return localizedMessage("remote.video.buffering");
    case "unsupported": return localizedMessage("remote.video.unsupported");
    case "decode-error": return localizedMessage("remote.video.decode.error");
  }
}

function Audio({
  file,
  playback,
}: {
  readonly file: VideoFile;
  readonly playback: LocalVideoPlayback;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("loading");
  useEffect(() => {
    const lifetime = new AbortController();
    playback.mediaUrl(file, lifetime.signal).then(
      (value) => {
        if (!lifetime.signal.aborted) setUrl(value);
      },
      (reason: unknown) => {
        if (!lifetime.signal.aborted) {
          setStatus({ error: reason instanceof Error ? reason.message : String(reason) });
        }
      },
    );
    return () => lifetime.abort();
  }, [file, playback]);
  return (
    <>
      {url === null ? null : (
        <audio
          src={url}
          controls
          autoPlay
          preload="metadata"
          aria-label={file.fileName}
          onPlaying={() => setStatus("playing")}
          onWaiting={() => setStatus("buffering")}
          onError={() => setStatus("decode-error")}
        />
      )}
      <p role="status">{statusText(status)}</p>
    </>
  );
}

function Video({
  file,
  source,
}: {
  readonly file: VideoFile;
  readonly source: PlaybackSource;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<PlaybackStatus>(
    source.type === "remote" ? "connecting" : "loading",
  );
  useEffect(() => {
    const lifetime = new AbortController();
    let playback: { close(): Promise<void> } | undefined;
    const error = (message: string) => {
      if (!lifetime.signal.aborted) setStatus({ error: message });
    };
    const play = playFunction(source);
    if (play === undefined) {
      setStatus("unsupported");
      return;
    }
    const element = video.current!;
    const decodeFailed = () => {
      setStatus("decode-error");
      lifetime.abort();
      void playback?.close();
    };
    element.addEventListener("error", decodeFailed, { once: true });
    void play({
      ...file,
      video: element,
      signal: lifetime.signal,
      onReady: () => {
        if (!lifetime.signal.aborted)
          setStatus("ready");
      },
      onError: error,
    }).then(
      (result) => {
        playback = result;
        if (lifetime.signal.aborted) void result.close();
      },
      (reason) =>
        error(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      element.removeEventListener("error", decodeFailed);
      lifetime.abort();
      void playback?.close();
    };
  }, [file, source]);
  return (
    <>
      <video
        ref={video}
        controls
        playsInline
        preload="metadata"
        aria-label={file.fileName}
        onPlaying={() => setStatus("playing")}
        onWaiting={() => setStatus("buffering")}
      />
      <p role="status">{statusText(status)}</p>
    </>
  );
}

function playFunction(
  source: PlaybackSource,
):
  | ((request: VideoPlaybackRequest) => Promise<{ close(): Promise<void> }>)
  | undefined {
  if (source.type === "local") return (request) => source.playback.play(request);
  const { remoteAccess } = source;
  if (
    remoteAccess.playCompletedFile === undefined ||
    remoteAccess.directFileSupported?.() !== true
  ) {
    return undefined;
  }
  return (request) => remoteAccess.playCompletedFile!(request);
}
