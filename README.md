# JSTorrent

JSTorrent is a BitTorrent client built around a first-party
Rust engine. The qualified JSTorrent desktop 0.3.0 replacement is now public. Android and
extension store delivery remain in progress; feature support stays bounded by
the recorded capability evidence.

The current product can perform real v1 downloads from magnet intake through
verified direct content, with tracker and DHT discovery, multiple peers,
durable session state, selective multi-file storage, and maintained first-party
desktop, Android, and iOS clients. Exact support claims and their evidence live
in the [feature-completeness scoreboard](docs/topics/capability-readiness.md)
and [protocol support matrix](docs/topics/protocol-support.md).

## Current Status

- **Functional, not feature-complete.** Ordinary supported downloads work, but
  important capabilities and product behavior remain unfinished. The
  [capability readiness record](docs/topics/capability-readiness.md) is the
  authoritative checklist and work queue.
- **Qualified JSTorrent desktop replacement is public.** Desktop `0.3.0`
  preserves the existing application identity and updater trust root. Exact
  signed packages, corresponding sources and all public download hashes pass;
  website links and production updater selectors are verified. Installed
  qualification and remaining store/physical gates are recorded in the
  [cutover checklist](docs/jstorrent-cutover-checklist.md). Separate incubation
  packages remain experimental and retain their own routes and signing root.
- **Platforms are at different readiness levels.** Desktop/web is the leading
  product and inspection surface. Android is functional with native engine and
  durable storage integration but still has product gaps. A non-latest
  ChromeOS Linux preview and its website bootstrap are public with physical
  x86_64 acceptance; the JSTorrent Beta Manifest V3 seed remains only a launch
  surface, not torrent control. Configured Linux headless service packages now
  have strict signed source release/update plumbing, an installed exact-LAN
  x86_64 service campaign, and native x86_64/ARM64 release jobs, but no public
  headless candidate or promoted stable channel. The
  first-party in-process iOS campaign now has simulator, physical-device,
  public-swarm, system-preview, and unsigned/development archive evidence, but
  no TestFlight or App Store distribution. See
  [client and platform readiness](docs/topics/client-surfaces.md).
- **Localization-ready, English-only.** Shared React/Tauri, Android, and iOS
  now use complete checked English catalogs with native locale fallback,
  plural/number formatting, and long-LTR/RTL pseudo-layout gates. Shipping a
  real non-English locale requires a separately reviewed translation cohort;
  see the [localization policy and workflow](docs/topics/localization.md).

## What JSTorrent Is

RSTorrent has one reusable Rust engine behind a typed application service:

```text
Desktop client ─┐
Android client ─┼──> application service ──> Rust torrent engine
iOS client ─────┤
Linux service ──┤
CLI and tests ──┘
```

The engine runs in-process in first-party clients and owns peer networking,
discovery, protocol state, hashing, scheduling, persistence, and hot-path file
I/O. Platform code owns operating-system integration such as windows,
activities, lifecycle, notifications, permissions, and Android document
access. RSTorrent is an independently implemented engine, not a wrapper around
libtorrent, librqbit, or a separate torrent daemon.

The desktop product uses a shared React interface hosted by Tauri and provides
Library, Transfers, and detailed Workbench views. Eligible verified files can
be opened through a bounded ephemeral HTTP capability in the browser or the
desktop system opener. Android uses a platform-appropriate Compose interface
over the same engine and application semantics, retaining its native complete-
file open path; presentation parity is not required.

In project terminology, unqualified **UI** or **web UI** means that shared
React product interface, whether it is browser-hosted or embedded by Tauri.
The former direct-DOM proof has been retired. Android presentation is named
explicitly as the **Android**, **Compose**, or **Android UI**; the Astro
`website/` is the project website rather than a product client.

## Standalone Downloader

Source builds include `rstorrent-download`, a finite foreground downloader
for one magnet URI or local `.torrent` file:

```bash
cargo build --locked --release -p rstorrent-session --bin rstorrent-download
target/release/rstorrent-download --output /path/to/downloads \
  'magnet:?xt=urn:btih:...'
target/release/rstorrent-download --output /path/to/downloads file.torrent
```

The output directory defaults to the current directory. Wanted bytes are
written directly to their final metainfo paths, so incomplete files can be
visible while the command runs; there is no publish or move step at the end.
Every non-padding file is selected unless a magnet contains a BEP 53 `so`
selection, in which case the same strict selection used by the product clients
is preserved.

The command uses the ordinary application service with private in-memory
SQLite state. It creates no profile or resume database, exits without seeding,
and conservatively checks existing payload again on a later invocation. A
same-user cooperative lock prevents two `rstorrent-download` processes from
using the same canonical output directory, but other clients do not
participate in that lock and must not write there concurrently. This binary is
currently a source-build capability; packaging and a stable machine-readable
CLI are not included.

## Intended Product And Deployment

The selected production direction is a near-term **JSTorrent** replacement
update using this Rust implementation. Desktop retains JSTorrent's existing
application identity and updater trust root, Android updates the existing Play
app, and this repo's extension replaces the existing production extension.
The successor adopts JSTorrent branding and original icons with a focused UI
refresh before cutover. Independent update ordering and best-effort legacy
migration are recorded in the deployment plan below. Separate incubation/test
identities remain while production delivery is qualified.

Desktop, Android, ChromeOS, and the maintained iOS client use or are intended
to use the same first-party Rust engine. A future JSTorrent browser extension
may attach as a control and presentation surface, while networking, hashing,
scheduling, persistence, and payload I/O remain in the native engine. The
rollout, backend choices, coexistence, and later graduation direction are
recorded in the
[product deployment and graduation plan](docs/topics/product-surfaces-and-migration.md)
and [long-term product vision](docs/vision.md).

Production candidate commands are in [DEVELOPMENT.md](DEVELOPMENT.md).
The [full cutover checklist](docs/jstorrent-cutover-checklist.md) tracks exact
signed/store artifacts, installed migration, staggered updates and recovery.
Preparing source identities and public trust does not qualify shipment.

## Incubation Compatibility Policy

All public desktop `0.1.x` packages and current mobile, ChromeOS Linux, and
headless previews are unsupported incubation builds. Their application-owned
state, persistence formats, generated application contracts, identifiers, and
update continuity remain disposable until a future version is explicitly
declared the first supported beta or release. `0.2.0` is a possible boundary,
not a selected or promised version.

Incubation changes do not need compatibility readers or migrations solely to
preserve an older preview. They must still handle incompatible state safely:
recognized obsolete application-private state may follow a bounded documented
reset, while malformed, ambiguous, busy, or future state fails closed. No
automatic reset may delete a user-selected payload root or direct content,
and old state cannot establish verified-content authority. Package signing,
update authenticity, and interoperability with external BitTorrent peers and
protocols remain correctness requirements rather than compatibility promises
to an incubation build.

## Engineering Character

Keep the Rust engine understandable: prefer explicit state ownership, plain
structs and enums, deterministic protocol logic, bounded handling of untrusted
input, supervised task lifecycles, structured diagnostics, and support claims
backed by executable evidence. Introduce abstraction when it solves a concrete
ownership, dependency, testing, reuse, or measured performance problem.

See the [engine engineering principles](docs/engineering-principles.md) for
the durable Rust and architecture guidance. See [Development](DEVELOPMENT.md)
for toolchain setup, build, test, and launch instructions.

## Documentation

- [Beta release readiness and gap checklist](docs/topics/beta-release-readiness.md)
- [Feature completeness and current queue](docs/topics/capability-readiness.md)
- [Client and platform readiness](docs/topics/client-surfaces.md)
- [Localization policy and catalog workflow](docs/topics/localization.md)
- [Exact protocol support](docs/topics/protocol-support.md)
- [Deployment and later JSTorrent graduation](docs/topics/product-surfaces-and-migration.md)
- [Product vision](docs/vision.md)
- [Project history and original motivation](docs/project-history.md)
- [Reference implementations and provenance](docs/references.md)
- [Living topics](docs/topics/README.md) and
  [bounded implementation tacticals](docs/tactical/README.md)

## License

JSTorrent is licensed under the [MIT License](LICENSE). Third-party components
and adapted source remain under their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
