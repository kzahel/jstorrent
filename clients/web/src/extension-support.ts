interface ExtensionRuntime {
  id?: string;
  sendMessage?(message: unknown): Promise<{ ok?: boolean; state?: { url?: string } }>;
}

// Older extension workers have no report-context operation. Keep their normal
// feedback path and never make diagnostics a prerequisite for connecting.
export async function extensionSupport(op: "support" | "feedback", failure?: string): Promise<string | undefined> {
  const runtime = (globalThis as unknown as { chrome?: { runtime?: ExtensionRuntime } }).chrome?.runtime;
  if (!runtime?.id || !runtime.sendMessage) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      runtime.sendMessage({ type: "productMetrics", op, ...(failure === undefined ? {} : { failure }) }),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 2000); }),
    ]);
    const url = response?.ok ? response.state?.url : undefined;
    if (url && new URL(url).origin === "https://jstorrent.com" && new URL(url).pathname === "/feedback.html") return url;
  } catch { /* The extension's older report path remains available. */ }
  finally { clearTimeout(timer); }
  return undefined;
}

export function onExtensionStatisticsChanged(refresh: () => void): () => void {
  const changes = (globalThis as unknown as { chrome?: { storage?: { onChanged?: {
    addListener(listener: (values: Record<string, unknown>, area: string) => void): void;
    removeListener(listener: (values: Record<string, unknown>, area: string) => void): void;
  } } } }).chrome?.storage?.onChanged;
  const listener = (values: Record<string, unknown>, area: string) => {
    if (area === "local" && "productMetricsV1" in values) refresh();
  };
  changes?.addListener(listener);
  return () => changes?.removeListener(listener);
}
