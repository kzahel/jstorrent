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

## Graduation Beyond Bring-Up

RSTorrent has since grown beyond those initial vertical slices into a
functional alpha client with durable application state, desktop and Android
products, real discovery and multi-peer downloading, responsive application
views, and extensive deterministic and interoperability evidence.

Current capabilities, gaps, platform readiness, priorities, and deployment
direction belong to the living records linked from the
[repository README](../README.md). Historical bring-up language should not be
used to understate the current product or constrain later product work.
