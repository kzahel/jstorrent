import { message as localizedMessage } from "../localization/runtime";
export const MAX_TORRENT_INPUT_BYTES = 16_384;

export type ValidatedTorrentInput =
  | { readonly accepted: true; readonly magnet: string }
  | { readonly accepted: false; readonly message: string };

export function validateTorrentInput(source: string): ValidatedTorrentInput {
  const input = source.trim();
  if (input.length === 0) {
    return {
      accepted: false,
      message:
        localizedMessage("inspection.torrent.input.paste.a.magnet.link.to.add.a"),
    };
  }
  if (/^https?:\/\//i.test(input)) {
    return {
      accepted: false,
      message:
        localizedMessage("inspection.torrent.input.remote.torrent.urls.are.not.supported.yet"),
    };
  }
  if (/^file:\/\//i.test(input)) {
    return {
      accepted: false,
      message:
        localizedMessage("inspection.torrent.input.torrent.file.selection.is.not.available.yet"),
    };
  }
  if (!input.startsWith("magnet:?")) {
    return {
      accepted: false,
      message: localizedMessage("inspection.torrent.input.enter.a.magnet.link.beginning.with.magnet"),
    };
  }
  if (new TextEncoder().encode(input).byteLength > MAX_TORRENT_INPUT_BYTES) {
    return {
      accepted: false,
      message: localizedMessage("inspection.torrent.input.magnet.links.are.limited.to.16.384"),
    };
  }
  return { accepted: true, magnet: input };
}

/**
 * Splits pasted text holding more than one magnet link into its items.
 * Returns null for a single item, which keeps the one-link add path.
 */
export function splitTorrentInputList(source: string): string[] | null {
  const items = source.split(/\s+/).filter((item) => item.length > 0);
  if (items.length < 2) return null;
  if (!items.some((item) => item.toLowerCase().startsWith("magnet:?"))) return null;
  return items;
}

/** A short name for a magnet link: its display name, or the link itself. */
export function magnetLabel(magnet: string): string {
  let name: string | null = null;
  if (magnet.toLowerCase().startsWith("magnet:?")) {
    try {
      name = new URLSearchParams(magnet.slice("magnet:?".length)).get("dn");
    } catch {
      name = null;
    }
  }
  const label = name?.trim() || magnet;
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
