<img src="extension/public/icons/js-128.png" alt="JSTorrent" width="64" align="left" style="margin-right: 16px;">

# JSTorrent

A modern, full-featured BitTorrent client for Chrome and other MV3-compatible browsers.

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/jstorrent/dbokmlpefliilbjldladbimlcfgbolhk)** | **[new.jstorrent.com](https://new.jstorrent.com)**


Works on ChromeOS, Mac, Windows, and Linux.

## Status

Open beta release.

## Features

### BitTorrent Protocol
- ✅ Full BitTorrent protocol implementation
- ✅ Magnet link support
- ✅ .torrent file support
- ✅ Protocol encryption (MSE/PE)
- ✅ Seeding and leeching
- ✅ Tit-for-tat choking algorithm
- ✅ Optimistic unchoking
- ✅ Rarest-first piece selection
- ✅ Endgame mode
- ✅ Request pipelining
- ✅ SHA1 piece verification
- ✅ Fast extension (BEP 6)
- ✅ Extension protocol (BEP 10)
- ✅ Metadata exchange / magnet resolution (BEP 9)

### Networking
- ✅ UPnP port mapping
- ✅ DHT (Distributed Hash Table)
- ✅ PEX (Peer Exchange)
- ✅ UDP and HTTP trackers
- ✅ IPv4 and IPv6

### Performance
- ✅ Native host for fast networking and disk I/O
- ✅ File skipping and priorities
- ✅ Bandwidth throttling
- ✅ Connection limits

### User Experience
- ✅ Traditional torrent client UI
- ✅ Customizable interface
- ✅ Super responsive
- ✅ Dark mode
- ✅ Drag and drop torrents
- ✅ Click magnet links to add
- ✅ Per-torrent and global statistics

## About

This is an open-source rewrite of the original JSTorrent Chrome App, rebuilt as a Chrome Extension after Chrome Apps were deprecated. The BitTorrent engine runs entirely in the browser.

Written in TypeScript with comprehensive test coverage, including integration tests against libtorrent.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions and project structure.

## License

Open source.
