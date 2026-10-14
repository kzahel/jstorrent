/** The website page that opens shared magnets (Tactical 347). */
export const SHARE_PAGE_URL = "https://jstorrent.com/share/";

/**
 * Builds a share link whose fragment is the magnet's own query string, so the
 * page rebuilds the magnet as `magnet:?` plus the fragment. The fragment is
 * never sent to the server.
 */
export function shareLinkFromMagnet(magnet: string): string {
  const prefix = "magnet:?";
  if (magnet.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Not a magnet link");
  }
  return `${SHARE_PAGE_URL}#${fragmentSafe(magnet.slice(prefix.length))}`;
}

// RFC 3986 fragment characters, plus `%` when it starts a valid escape.
function fragmentSafe(value: string): string {
  return value.replace(
    /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~!$&'()*+,;=:@/?%]/gu,
    (character) => encodeURIComponent(character),
  );
}
