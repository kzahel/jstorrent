/**
 * Test magnet links for dev mode.
 *
 * These match the test torrents in android/app/src/main/java/com/jstorrent/app/debug/TestTorrentHelper.kt
 */

/**
 * Ubuntu 24.04.3 Server ISO - real-world torrent for testing with public swarm.
 */
export const UBUNTU_SERVER_MAGNET =
  'magnet:?xt=urn:btih:a1dfefec1a9dd7fa8a041ebeeea271db55126d2f' +
  '&dn=ubuntu-24.04.3-live-server-amd64.iso' +
  '&tr=https%3A%2F%2Ftorrent.ubuntu.com%2Fannounce' +
  '&tr=https%3A%2F%2Fipv6.torrent.ubuntu.com%2Fannounce'

/**
 * Big Buck Bunny - public domain video with reliable UDP and WebSocket trackers.
 */
export const BIG_BUCK_BUNNY_MAGNET =
  'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c' +
  '&dn=Big+Buck+Bunny' +
  '&tr=udp%3A%2F%2Fexplodie.org%3A6969' +
  '&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969' +
  '&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337' +
  '&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969' +
  '&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337' +
  '&tr=wss%3A%2F%2Ftracker.btorrent.xyz' +
  '&tr=wss%3A%2F%2Ftracker.fastcast.nz' +
  '&tr=wss%3A%2F%2Ftracker.openwebtorrent.com' +
  '&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F' +
  '&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent'
