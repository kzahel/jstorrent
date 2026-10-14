# Tactical 341: Peer Sources In The Trackers Tab

Status: Complete, 2026-10-14. Maintainer-directed web presentation slice;
commit authorized.
Topics: `web-ui-design`, `tracker-discovery`, `dht-discovery`,
`application-view-api`.

## Scope And Stopping Condition

The global DHT tab describes routing buckets, which does not answer how a
torrent is finding peers. Following the common qBittorrent convention, the
selected torrent's Trackers tab gains a short **Other sources** list above the
tracker table: DHT, Peer exchange, Incoming and, when it has supplied peers,
Local network. Each row gives a plain status and how many known and connected
peers came from that source.

Stop when the list renders from existing views, follows the torrent selection,
is covered by component tests and a demo-mode screenshot, and the web checks
pass. A later global Discovery overview (step 2) and any engine-side search
history are separate decisions.

Non-goals: engine, contract or Android changes; per-torrent DHT announce
results; completed-search history; replacing the global DHT tab; tracker table
changes beyond placement.

## Data And Ownership

Presentation only. While the Trackers tab is open the client also subscribes
to the existing `torrent_swarm` view for the selected torrent and the
`session_dht` view, both at a 1 s delivery interval. The swarm view is already
bounded by its `maximum_records`; DHT lookups are bounded by the engine.

- **DHT status:** `effective_dht_enabled` and the DHT lifecycle, plus any
  in-progress lookup whose `target_id` equals the torrent's v1 hash or the
  first 20 bytes of its v2 hash (BEP 52). Routing refresh lookups use other
  targets and never match.
- **Peer exchange:** `effective_peer_exchange_enabled`.
- **Incoming:** `listener_status` (off, listening, or unavailable).
- **Counts:** swarm records whose `sources` include the source; connected
  means swarm state `connected`. A record with several sources counts for each.

The list never claims an announce or search succeeded beyond what these views
report. Without swarm or DHT data it shows the setting state and dashes.

## Validation

- Component tests: source matching for v1, v2-only and non-matching lookups;
  disabled DHT/PEX/incoming; counts across multi-source records.
- Web typecheck, localization check and unit suite.
- Demo-mode screenshot of the Trackers tab.

## Evidence

- `peer-sources.test.ts` covers per-source counts with multi-source records,
  the missing-swarm dash, conditional Local network, v1 and truncated-v2 DHT
  target matching against unrelated lookups, and off/starting/offline/listening
  states. `LiveApplication.test.ts` asserts the Trackers tab subscribes the
  swarm and DHT views at 1 s; an App test renders the rows from the
  `swarm-lifecycle` demo (DHT 3 known, PEX 2 known/1 connected).
- Web typecheck, localization check and unit suite (555 passed, 2 skipped).
- Demo-mode screenshots of the Trackers tab. Demo mode now also materializes
  swarm and DHT data for Trackers, matching the live client. No demo scenario
  has a DHT lookup targeting its own torrent, so "Searching now" is covered by
  unit tests only.
