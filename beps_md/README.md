# BitTorrent Enhancement Proposals (BEPs) - Markdown

Converted from reStructuredText sources at https://github.com/bittorrent/bittorrent.org

Conversion performed using `pandoc -f rst -t gfm`.

## Categories

### final-active/ (7 BEPs)
Final and Active Process BEPs - foundational documents and the protocol specification.

| BEP | Title |
|-----|-------|
| 0 | Index of BitTorrent Enhancement Proposals |
| 1 | The BitTorrent Enhancement Proposal Process |
| 2 | Sample reStructured Text BEP Template |
| 3 | The BitTorrent Protocol Specification |
| 4 | Assigned Numbers |
| 20 | Peer ID Conventions |
| 1000 | Pending Standards Track Documents |

### accepted/ (13 BEPs)
Deployed in implementations and proven useful. Await final blessing from BDFL.

| BEP | Title |
|-----|-------|
| 5 | DHT Protocol |
| 6 | Fast Extension |
| 9 | Extension for Peers to Send Metadata Files |
| 10 | Extension Protocol |
| 11 | Peer Exchange (PEX) |
| 12 | Multitracker Metadata Extension |
| 14 | Local Service Discovery |
| 15 | UDP Tracker Protocol for BitTorrent |
| 19 | WebSeed - HTTP/FTP Seeding (GetRight style) |
| 23 | Tracker Returns Compact Peer Lists |
| 27 | Private Torrents |
| 29 | uTorrent transport protocol |
| 55 | Holepunch extension |

### draft/ (31 BEPs)
Under consideration for standardization.

| BEP | Title |
|-----|-------|
| 7 | IPv6 Tracker Extension |
| 16 | Superseeding |
| 17 | HTTP Seeding |
| 21 | Extension for partial seeds |
| 24 | Tracker Returns External IP |
| 25 | An Alternate BitTorrent Cache Discovery Protocol |
| 30 | Merkle hash torrent extension |
| 31 | Failure Retry Extension |
| 32 | BitTorrent DHT Extensions for IPv6 |
| 33 | DHT Scrapes |
| 34 | DNS Tracker Preferences |
| 35 | Torrent Signing |
| 36 | Torrent RSS feeds |
| 37 | Anonymous BitTorrent over proxies |
| 38 | Finding Local Data Via Torrent File Hints |
| 39 | Updating Torrents Via Feed URL |
| 40 | Canonical Peer Priority |
| 41 | UDP Tracker Protocol Extensions |
| 42 | DHT Security extension |
| 43 | Read-only DHT Nodes |
| 44 | Storing arbitrary data in the DHT |
| 45 | Multiple-address operation for the BitTorrent DHT |
| 46 | Updating Torrents Via DHT Mutable Items |
| 47 | Padding files and extended file attributes |
| 48 | Tracker Protocol Extension: Scrape |
| 49 | Distributed Torrent Feeds |
| 50 | Publish/Subscribe Protocol |
| 51 | DHT Infohash Indexing |
| 52 | The BitTorrent Protocol Specification v2 |
| 53 | Magnet URI extension - Select specific file indices for download |
| 54 | The lt_donthave extension |

### deferred/ (5 BEPs)
Not progressing toward standardization, but not yet withdrawn.

| BEP | Title |
|-----|-------|
| 8 | Tracker Peer Obfuscation |
| 18 | Search Engine Specification |
| 22 | BitTorrent Local Tracker Discovery Protocol |
| 26 | Zeroconf Peer Advertising and Discovery |
| 28 | Tracker exchange extension |

## Notes

- BEP 25 and 37 are marked "Draft" in their source files but weren't listed on the official index page
- Total: 56 BEPs converted
- Source repo snapshot from May 2020
