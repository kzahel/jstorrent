/**
 * Browser destinations for files the page writes itself. A save picker
 * streams to disk; without one, bytes are held up to `blobLimit` and handed
 * to the browser as a download when the sink closes.
 */
export interface BrowserFileSink {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface BrowserFileSinkOptions {
  /** Most bytes the download fallback may hold in memory. */
  readonly blobLimit: number;
  /** Error for a file larger than `blobLimit` without a save picker. */
  readonly tooLarge: () => Error;
  readonly types?: readonly BrowserFileType[];
}

export interface BrowserFileType {
  readonly description: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: readonly BrowserFileType[];
  }) => Promise<FileSystemFileHandle>;
}

/**
 * Starts destination selection immediately. Call this directly from a user
 * activation. Cancelling the picker rejects with an `AbortError`.
 * `fileLength` is null when the size is not known yet.
 */
export function prepareBrowserFileSink(
  fileName: string,
  fileLength: bigint | null,
  options: BrowserFileSinkOptions,
): Promise<BrowserFileSink> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker !== undefined) {
    const handle = picker.call(window, {
      suggestedName: safeFileName(fileName),
      ...(options.types === undefined ? {} : { types: options.types }),
    });
    return handle.then(async (file) => {
      const writable = await file.createWritable();
      return {
        write: async (bytes) => writable.write(bytes),
        close: async () => writable.close(),
        abort: async () => writable.abort().catch(() => undefined),
      };
    });
  }
  if (fileLength !== null && fileLength > BigInt(options.blobLimit)) {
    return Promise.reject(options.tooLarge());
  }
  const chunks: ArrayBuffer[] = [];
  let bytesWritten = 0;
  return Promise.resolve({
    write: async (bytes) => {
      if (bytesWritten + bytes.byteLength > options.blobLimit) {
        throw options.tooLarge();
      }
      chunks.push(bytes.slice().buffer);
      bytesWritten += bytes.byteLength;
    },
    close: async () => {
      const url = URL.createObjectURL(new Blob(chunks));
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = safeFileName(fileName);
        anchor.style.display = "none";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
    abort: async () => {
      chunks.length = 0;
      bytesWritten = 0;
    },
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function safeFileName(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  return leaf.length > 0 ? leaf.slice(0, 255) : "download";
}
