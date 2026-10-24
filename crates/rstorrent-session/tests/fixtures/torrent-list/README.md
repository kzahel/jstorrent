# Version-1 torrent-list ZIP compatibility fixture

`v1-zip4.zip` was generated on 2026-10-17 by independently authored Rust code
using the unmodified MIT-licensed registry zip 4.6.1 and flate2 1.1.9.
It contains a Deflated `manifest.json` and Stored `torrents/a.torrent`, with
one metainfo record and one magnet record. All names, hashes and bencode are
authored test data, with no user information or copied upstream fixtures.
The bencode is a parser payload, not verified downloadable content.

The frozen file checks pre-upgrade reader compatibility after moving to ZIP 9;
it is not a released-store fixture or a new bundle-format version. The
independent producer also verified that ZIP 4 reads ZIP 9.0.4 Stored output.

SHA-256: `54c5eb1ca98036c0924259dd4f2b51d1493c1603c016d2a312a7615b18ab1030`
