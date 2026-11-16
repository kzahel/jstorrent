import { parseShareFragment } from './share-link.js'

export const MAX_LAUNCH_LENGTH = 64 * 1024
export const MAX_LAUNCH_MAGNET_LENGTH = 16 * 1024

// Decode the documented envelope once. Never forward tokens or local paths.
export function parseLegacyLaunch(search, fragment) {
  const empty = { magnet: null, launchUrl: 'jstorrent://launch' }
  if (new TextEncoder().encode(search + fragment).length > MAX_LAUNCH_LENGTH || /%(?![0-9a-f]{2})/i.test(search + fragment)) return empty
  try { decodeURIComponent(search); decodeURIComponent(fragment) } catch { return empty }
  let source = fragment
  if (search) {
    const params = new URLSearchParams(search)
    const magnets = [...params.getAll('magnet'), ...params.getAll('magnet_uri')]
    if (magnets.length > 1 || (magnets.length && fragment)) return empty
    if (magnets.length) source = '#magnet=' + encodeURIComponent(magnets[0])
  }
  const keys = [...new URLSearchParams(source.replace(/^#/, '')).keys()].map(key => key.trim().toLowerCase())
  if (keys.filter(key => key === 'magnet' || key === 'magnet_uri').length > 1 || keys.filter(key => key === 'hash').length > 1) return empty
  const parsed = parseShareFragment(source)
  if (!parsed.ok || new TextEncoder().encode(parsed.magnet).length > MAX_LAUNCH_MAGNET_LENGTH) return empty
  return { magnet: parsed.magnet, launchUrl: 'jstorrent://launch?magnet=' + encodeURIComponent(parsed.magnet) }
}

export function unregisterLegacyHandlers(browser, origin) {
  if (typeof browser.unregisterProtocolHandler !== 'function') return 'Use your browser protocol handler settings to remove old magnet web handlers.'
  try {
    for (const path of ['/add/#magnet_uri=%s', '/share/#magnet_uri=%s']) {
      browser.unregisterProtocolHandler('magnet', origin + path)
    }
    return 'Requested removal of the two known handlers for this site. Check browser settings for other profiles or older HTTP registrations.'
  } catch {
    return 'Your browser did not allow removal. Remove the old magnet web handler in browser settings.'
  }
}
