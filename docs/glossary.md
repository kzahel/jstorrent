# Glossary

Shared meanings for words that are easy to overload. Topics and tacticals
may define narrower terms, but should not contradict these.

## Hosts, clients and peers

JSTorrent is a BitTorrent client in the everyday sense, but inside this
repository "client" means something narrower. Use these terms:

| Term | Meaning |
| --- | --- |
| **Peer** | Another BitTorrent program the engine exchanges pieces with over the BitTorrent protocol. Use *peer*, not *client*, for these, except when quoting BEPs or naming the product category ("a BitTorrent client"). |
| **Engine** | The first-party Rust BitTorrent implementation: protocol, peers, storage, scheduling (`rstorrent-engine`, with session state in `rstorrent-session`). |
| **Host** | A running JSTorrent process that owns an engine and a profile and serves the application API: the desktop app, the Android app, the iOS app, the headless server, the Crostini gateway. Older docs call this the *backend*. |
| **Client** | Anything that connects to a host through the application API to show or control it: the web UI in the desktop window, the hosted remote controller, the extension companion pages, the gateway-served web UI, Android Compose, iOS. Some run in the same process as their host. |
| **UI**, **web UI**, **frontend** | The shared React application in `clients/web`, a client. Android Compose is named explicitly as *Android* or *Compose*. |
| **Profile** | A host's durable state: its session catalog, settings and product state. |

A **surface** or **product** is something we ship and users install:
desktop, Android, extension, headless, Crostini, iOS. A surface can contain
a host, a client or both. Desktop, Android and iOS ship a host with a
matching client; the extension ships only clients; the hosted remote controller is a
client served from the website.

## Connecting a client to a host

| Term | Meaning |
| --- | --- |
| **Application API** / **contract** | The generated types, schema and validators a client and host exchange (`clients/web/src/api/generated`). See [`application-view-api`](topics/application-view-api.md). |
| **Hello** | The host's first message: API version, capabilities and product facts. |
| **Host capability** | A named fact a host advertises in its hello that a client gates a feature on. Registry: `crates/rstorrent-session/src/host_capabilities.rs`. |
| **Call** | One correlated request and response, such as a command or opening a view set. |
| **View set** | The leased per-client projection state a host keeps for one UI. Not an engine or login session. |
| **Gateway** | The part of a host that serves the application API over HTTP and WebSocket (`rstorrent-gateway`), and for headless and Crostini also serves the web UI. |
| **Hosted remote controller** | The web UI build at `jstorrent.com/remote/`, which reaches a host through the relay. |
| **Companion** | Extension pages that control the Android app (ChromeOS) or the desktop app. |
| **Relay** | The service that forwards encrypted circuits between remote clients and hosts (`rstorrent-remote-relay`). It sees neither side's plaintext. |
| **Remote host** | The component inside a host that keeps the host reachable through the relay (`rstorrent-remote-host`). Despite the name it is part of a host, not a separate host. |
| **Relay circuit** | One end-to-end encrypted path between one client and one host through the relay. |

Do not use *session* for any of these; it already means the engine session,
the application-service lifetime and remote authentication.

## Versions and compatibility

| Term | Meaning |
| --- | --- |
| **Release** | A tagged, published build of one surface (`desktop-v*`, `android-v*`, an extension version). |
| **Matched pair** | A host and client from the same release, such as the desktop app and its own window. They always agree. |
| **Older host / newer host**, **older client / newer client** | Relative to the other side of one connection. The hosted remote controller is always the newest client; an extension awaiting store review can be older than the host it controls. |
| **Support window** | How far back mixed versions must keep working (30 days at first). See [`mixed-version-compatibility`](topics/mixed-version-compatibility.md). |
| **Strict client** | A released client that rejects host data it does not know (extension 1.1.4 and older). |
| **Tolerant client** | A client that ignores host additions it does not know (from extension 1.1.5 and the current web UI). |
