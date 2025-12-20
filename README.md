<img src="extension/public/icons/js-128.png" alt="JSTorrent" width="64" align="left" style="margin-right: 16px;">

# JSTorrent

A modern, full-featured BitTorrent client for Chrome and other MV3-compatible browsers.

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/jstorrent/dbokmlpefliilbjldladbimlcfgbolhk)**

Works on ChromeOS, Mac, Windows, and Linux.

## Status

Open beta release.

## Features

### BitTorrent Protocol
- [x] Full BitTorrent protocol implementation
- [x] Magnet link support
- [x] .torrent file support
- [x] Protocol encryption (MSE/PE)
- [x] Seeding and leeching
- [x] Tit-for-tat choking algorithm
- [x] Optimistic unchoking
- [x] Rarest-first piece selection
- [x] Endgame mode
- [x] Request pipelining
- [x] SHA1 piece verification
- [x] Fast extension (BEP 6)
- [x] Extension protocol (BEP 10)
- [x] Metadata exchange / magnet resolution (BEP 9)

### Networking
- [x] UPnP port mapping
- [x] DHT (Distributed Hash Table)
- [x] PEX (Peer Exchange)
- [x] UDP and HTTP trackers
- [x] IPv4 and IPv6

### Performance
- [x] Native host for fast networking and disk I/O
- [x] File skipping and priorities
- [x] Bandwidth throttling
- [x] Connection limits

### User Experience
- [x] Traditional torrent client UI
- [x] Customizable interface
- [x] Super responsive
- [x] Dark mode
- [x] Drag and drop torrents
- [x] Click magnet links to add
- [x] Per-torrent and global statistics

## About

This is an open-source rewrite of the original JSTorrent Chrome App, rebuilt as a Chrome Extension after Chrome Apps were deprecated. The BitTorrent engine runs entirely in the browser.

Written in TypeScript with comprehensive test coverage, including integration tests against libtorrent.

Visit [new.jstorrent.com](https://new.jstorrent.com) for installation with automatic extension detection.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions and project structure.

## License

Open source.
