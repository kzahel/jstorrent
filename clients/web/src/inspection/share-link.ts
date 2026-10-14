/** The website page that opens shared magnets (Tactical 347). */
export const SHARE_PAGE_URL = "https://jstorrent.com/share/";

/**
 * Display-only keys for one shared file (Tactical 357). The share page shows
 * them as the sharer's claim and strips every `jst.` key before it rebuilds
 * the magnet.
 */
export interface ShareLinkDisplay {
  /** The file's display name, a basename. */
  readonly fileName?: string;
  /** The file's length in bytes, as decimal digits. */
  readonly fileSize?: string;
}

/**
 * Builds a share link whose fragment is the magnet's own query string, so the
 * page rebuilds the magnet as `magnet:?` plus the fragment. The fragment is
 * never sent to the server. Display keys follow the magnet's parameters.
 */
export function shareLinkFromMagnet(
  magnet: string,
  display: ShareLinkDisplay = {},
): string {
  const prefix = "magnet:?";
  if (magnet.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Not a magnet link");
  }
  let fragment = fragmentSafe(magnet.slice(prefix.length));
  if (display.fileName !== undefined && display.fileName !== "") {
    fragment += `&jst.file=${encodeURIComponent(display.fileName)}`;
  }
  if (
    display.fileSize !== undefined &&
    /^[0-9]{1,19}$/.test(display.fileSize)
  ) {
    fragment += `&jst.size=${display.fileSize}`;
  }
  return `${SHARE_PAGE_URL}#${fragment}`;
}

/** True when the magnet carries a nonempty BEP 53 `so` selection. */
export function magnetSelectsFiles(magnet: string): boolean {
  const query = magnet.slice(magnet.indexOf("?") + 1);
  return query
    .split("&")
    .some((parameter) => /^so(?:\.[0-9]+)?=./i.test(parameter));
}

// RFC 3986 fragment characters, plus `%` when it starts a valid escape.
function fragmentSafe(value: string): string {
  return value.replace(
    /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~!$&'()*+,;=:@/?%]/gu,
    (character) => encodeURIComponent(character),
  );
}
