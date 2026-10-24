# Project History And Original Motivation

Status: historical background. This document does not own current product
status, architecture, priorities, or release requirements; follow the living
topics linked from the repository README for current guidance.

## JSTorrent Lineage

JSTorrent began as a Chrome App and adapted repeatedly as the platform changed:
Chrome extension, native messaging host, IO daemon, Android companion, native
mobile embedding, and Tauri desktop app. Each adaptation solved a real problem,
but the combined product accumulated several runtimes, process boundaries,
bridges, and conformance surfaces.

RSTorrent began as an independent implementation rather than a line-by-line
translation of JSTorrent. The separate working name and repository made it
possible to replace the engine architecture without destabilizing the existing
product or treating its internal APIs, persistence formats, and process
topology as compatibility requirements.

The intended lineage was always product succession rather than a permanently
separate brand: prove a first-party native engine and apps, then graduate
them into JSTorrent when the replacement is ready.

## Why A First-Party Rust Engine

The project started from these product constraints:

- the torrent engine, networking, hashing, persistence, and scheduling should
  be first-party Rust;
- the engine should normally run in the same process as its client;
- platform code should expose operating-system capabilities rather than proxy
  ordinary torrent sockets or payload I/O through another runtime;
- Android and ChromeOS should be first-class product surfaces;
- desktop should provide a fast development and validation surface and become
  a first-class surface of the same engine; and
- early implementation should be free to evolve without inheriting JSTorrent
  feature parity or internal compatibility as its starting obligation.

BitTorrent was also a useful environment for ambitious automated implementation
and review experiments. Generated work could be evaluated against protocol
specifications, mature implementations, deterministic fixtures, and known
product behavior rather than appearance alone.

## Original Bring-Up Direction

The initial center of gravity was a reusable Rust engine with a small
application-facing command, snapshot, and event API:

```text
Android app ────┐
Desktop app ────┼──> application service ──> Rust torrent engine
CLI and tests ──┘
```

Rust was expected to own peer networking, protocol state, hashing, scheduling,
persistence, and hot-path file I/O. Android could use Kotlin for activities,
Compose, foreground services, notifications, permissions, and Storage Access
Framework integration, but peer and file payloads would not pass through a
Kotlin socket proxy or serialized daemon protocol.

The original bring-up deliberately did not require a Chrome extension, native
messaging host, Android companion server, generic daemon, every platform,
JSTorrent feature parity, or compatibility with JSTorrent's internal APIs and
persistence. These were scope controls for establishing the first functional
vertical slices, not permanent descriptions of the mature product.

## Incubation And Graduation

The planned progression was:

1. build and validate the engine under the RSTorrent working name;
2. ship an explicitly experimental native app to learn from real use;
3. establish desktop and Android/ChromeOS products around the same engine,
   while front-loading physical iOS storage and lifecycle constraints;
4. scope a best-effort legacy-state import and a browser-extension control
   boundary from proven application contracts;
5. graduate the implementation into the JSTorrent product and brand once it
   was safer and more useful than the engine it replaced; and
6. retire the legacy engine deliberately rather than maintain two product
   architectures.

Graduation was to rest on evidence rather than a demonstration: reliable
download, seed, verify, resume, and recovery; interoperability with mature
clients and real swarms; bounded resources and measured hot paths; support
diagnostics; physical Android/ChromeOS lifecycle and storage validation;
application contracts shared by more than one client; a reviewed legacy-state
transition; and updates that travel through JSTorrent's established
application and updater identity without corrupting retained state.

RSTorrent grew through those slices into a functional client with durable
application state, desktop and Android products, real discovery and
multi-peer downloading, and extensive deterministic and interoperability
evidence. JSTorrent succession was selected on 2026-09-30: the Rust
implementation ships as normal updates to the existing
`com.jstorrent.desktop` app and updater trust root, the `com.jstorrent.app`
Play app, and the production Chrome Web Store item. Desktop 0.3.0 was its
first public JSTorrent release. On 2026-10-11 the maintainer froze the
separate RSTorrent release track; its routes, keys, and artifacts remain only
as legacy compatibility.

The `JS` in JSTorrent describes the project's origin, not an implementation
promise; the brand means something closer to "just torrent".

Current capabilities, gaps, and direction belong to the living records linked
from the [repository README](../README.md) and [AGENTS.md](../AGENTS.md).
Historical bring-up language should not be used to understate the current
product or constrain later product work.
