# Tactical 342: Deliver DHT Peers As Replies Arrive

Status: Complete, 2026-10-14. Maintainer-directed engine slice; commit
authorized.
Topics: `dht-discovery`, `oracle-driven-engine-campaign`, `web-ui-design`.

## Problem

A DHT search collects peers from each `get_peers` reply but hands them to the
torrent only when the whole lookup group, including any `announce_peer` phase
and both address families, finishes (`LookupGroup::finish`). Until then the
torrent cannot dial those peers, and Tactical 341's Trackers tab shows
"Searching now, 45 peers found" beside zero known DHT peers. Magnets that
depend on DHT wait the longest.

## Oracle

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:

- `src/kademlia/get_peers.cpp::get_peers::got_peers` invokes the data
  callback for each reply that carries `values`.
- `src/kademlia/node.cpp::node::announce` runs `get_peers` with the caller's
  callback; `dht_tracker::announce` fans it out per address family.
- `src/torrent.cpp::torrent::dht_announce` binds
  `on_dht_announce_response`, which adds each batch to the peer list.
- `test/test_dht.cpp::test_get_peers` (`get_peers_v4`, `get_peers_v6`) sends
  peers in two replies and requires every peer to reach the callback.

Adopted: peers reach the torrent per reply, before the search or announce
ends. Intentional differences: delivery is best-effort and deduplicated per
lookup group, and the final result remains the authoritative complete set, so
a dropped batch only delays a peer until the search ends.

## Scope And Stopping Condition

- The DHT actor accepts an optional bounded progress sender with `lookup` and
  `lookup_and_announce_ports`. When a reply adds peers to a family lookup, the
  group forwards only peers it has not streamed before, using `try_send`; a
  full or closed channel never blocks the actor. Coalesced requesters joining
  a running group first receive the peers already streamed.
- The discovery advertisement owner gives each DHT operation a progress
  channel. The operation task forwards batches to the owner over a bounded
  channel with `try_send`; the owner applies them only when the torrent
  registration generation and DHT epoch still match, through the same policy
  filter and swarm observation as the final result.
- Stop after deterministic DHT and advertisement tests, the Rust baseline,
  Android library compilation for the engine, topic and checkpoint updates.

Non-goals: changing lookup scheduling, intervals, `MAX_LOOKUP_PEERS`, announce
behavior, DHT statistics or the inspection contract; completed-search history.

## Ownership, Cancellation And Bounds

- The DHT actor still owns lookups. Progress senders live in the lookup group
  and drop when it finishes or is cancelled, which ends the operation task's
  forwarding loop. Streamed-peer memory is bounded by `MAX_LOOKUP_PEERS` per
  family.
- Per-operation channels hold at most 8 batches; the owner channel holds at
  most 64. Each batch carries at most one reply's peers, already capped by the
  lookup's 200-peer limit.
- The owner applies batches without awaiting; stale generations or epochs are
  ignored. Swarm observation is idempotent, so the final result re-observing
  streamed peers adds nothing.

## Validation

- DHT unit test: two replies stream two batches before the lookup finishes,
  duplicates are not resent, the final result still contains every peer, and
  a full progress channel does not stall the lookup.
- Advertisement test: streamed batches reach the swarm as DHT peers before
  the operation completes, and batches for a stale epoch are ignored.
- `cargo fmt`, `cargo clippy --workspace -D warnings`, `cargo test --workspace`,
  and an Android-target build of the engine crate.

## Evidence

- `dht::tests::lookup_streams_new_peers_per_reply_before_finishing`: two
  scripted nodes; node B withholds its reply while node A's two peers arrive
  as a batch and the lookup is still running. B's reply then streams only the
  new peer (its duplicate is filtered), the final result holds all three, and
  the progress channel closes with the lookup.
- `dht::tests::full_progress_channel_never_stalls_the_lookup`: a full
  one-slot channel loses the early copy but the lookup completes with every
  peer.
- `advertisement::tests::early_dht_peer_batches_apply_only_to_the_current_epoch`
  and `dht_peers_reach_the_swarm_before_the_lookup_finishes`: a running
  advertisement service adds node A's peer to the torrent's swarm as a DHT
  peer while node B withholds its reply; a later-epoch batch is ignored.
- With per-reply forwarding disabled, both end-to-end tests fail (5 s
  timeouts); they pass with it.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`,
  `cargo test --workspace` (1618 passed), and `clients/android/build.sh debug`
  (both Android ABIs, JVM unit tests) pass. No contract or generated boundary
  changed.
