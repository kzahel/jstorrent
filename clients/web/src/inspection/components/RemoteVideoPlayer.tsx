import { message as localizedMessage } from "../../localization/runtime";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import type { DesktopRemoteAccess } from "../remote-access/types";
import styles from "./RemoteVideoPlayer.module.css";

export interface RemoteVideoFile {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly lengthBytes: string;
}
const PlaybackContext = createContext<{
  remote: boolean;
  play(file: RemoteVideoFile): void;
}>({
  remote: false,
  play: () => {},
});
export const useRemotePlayback = () => useContext(PlaybackContext);
export function canPlayRemoteFile(name: string, availability: string): boolean {
  return availability === "available" && /\.(mp4|m4v)$/i.test(name);
}
export function RemotePlaybackProvider({
  remoteAccess,
  children,
}: {
  readonly remoteAccess?: DesktopRemoteAccess | undefined;
  readonly children: ReactNode;
}) {
  const [file, setFile] = useState<RemoteVideoFile | null>(null);
  const remote = remoteAccess?.scope === "remote";
  return (
    <PlaybackContext.Provider value={{ remote, play: setFile }}>
      {children}
      {remote && file ? (
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
                <button
                  autoFocus
                  onClick={() => setFile(null)}
                  aria-label={localizedMessage("remote.video.close.label")}
                >
                  {localizedMessage("remote.video.close")}
                </button>
              </header>
              <Video
                key={`${file.torrentId}:${file.fileIndex}`}
                file={file}
                remoteAccess={remoteAccess}
              />
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </PlaybackContext.Provider>
  );
}
function Video({
  file,
  remoteAccess,
}: {
  readonly file: RemoteVideoFile;
  readonly remoteAccess: DesktopRemoteAccess;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState(
    localizedMessage("remote.video.connecting"),
  );
  useEffect(() => {
    const lifetime = new AbortController();
    let playback: { close(): Promise<void> } | undefined;
    const error = (message: string) => {
      if (!lifetime.signal.aborted) setStatus(message);
    };
    if (
      !remoteAccess.playCompletedFile ||
      remoteAccess.directFileSupported?.() !== true
    ) {
      setStatus(localizedMessage("remote.video.unsupported"));
      return;
    }
    const element = video.current!;
    const decodeFailed = () => {
      error(localizedMessage("remote.video.decode.error"));
      lifetime.abort();
      void playback?.close();
    };
    element.addEventListener("error", decodeFailed, { once: true });
    void remoteAccess
      .playCompletedFile({
        ...file,
        video: element,
        signal: lifetime.signal,
        onReady: () => {
          if (!lifetime.signal.aborted)
            setStatus(localizedMessage("remote.video.ready"));
        },
        onError: error,
      })
      .then(
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
  }, [file, remoteAccess]);
  return (
    <>
      <video
        ref={video}
        controls
        playsInline
        preload="metadata"
        aria-label={file.fileName}
        onPlaying={() => setStatus(localizedMessage("remote.video.playing"))}
        onWaiting={() => setStatus(localizedMessage("remote.video.buffering"))}
      />
      <p role="status">{status}</p>
    </>
  );
}
