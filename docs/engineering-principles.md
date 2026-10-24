# Engine Engineering Principles

Status: accepted invariants for the shipped engine and the application layers
around it.

These describe the engineering character to preserve as the engine changes.
They are defaults, not ceremony: a change may depart from one when current
evidence justifies it, but the tradeoff should be deliberate and recorded. The
goal is local reasoning: a maintainer can tell who owns state, what caused a
transition, where an operation can fail, and how to reproduce it.

## Invariants

- Peer-controlled input cannot cause unbounded allocation or unbounded queued
  work.
- Unverified data is never reported or presented as verified content.
- Protocol and deterministic scheduling behavior can be tested without real
  sockets, storage, or wall-clock time.
- Every background task has an owner and an observable termination path.
- A peer-local failure cannot corrupt torrent- or session-wide state.
- Hot-path peer and piece data does not cross a generic process or language
  proxy.
- Diagnostics can explain important state transitions without becoming the
  application API or leaking payload data.
- Product support claims are backed by recorded evidence.

## Simplicity And Abstraction

Use plain structs, enums, functions, and coherent modules. Introduce a trait
for a concrete seam: more than one real implementation, an operating-system or
storage capability boundary, substitution needed for important deterministic
tests, or a dependency whose isolation materially improves the design. Use
generics when they improve correctness or measured hot-path behavior without
hiding control flow. Avoid speculative service layers, dependency injection,
async trait surfaces, or actor frameworks. Similar-looking code is not
automatically the same policy.

## Ownership, Concurrency, And Boundaries

Mutable state has an identifiable owner, and commands, events, and state
transitions make mutation explicit. `Arc<Mutex<Everything>>`, global mutable
registries, and detached tasks are not the default answer to coordination.
Every background task has an owner, a cancellation signal, observable
completion and failure, and a join or supervision path. Shutdown is a
correctness path.

Protocol values, codecs, and deterministic state transitions stay independent
from Tokio, sockets, filesystems, task handles, channels, and system clocks.
Runtime and platform code depend inward on them. Scheduling policy that needs
time or randomness takes them as controllable inputs.

Platform integration exposes capabilities to the engine, such as a usable file
descriptor for bulk I/O, rather than moving networking or piece data through a
proxy or high-frequency language callbacks. Extension and remote control
channels carry application commands, snapshots, and events only.

## Untrusted Input And Resource Bounds

Metainfo, tracker responses, DHT traffic, extension messages, and every peer
byte are untrusted.

- Validate lengths, ranges, identifiers, and state preconditions before
  allocation, indexing, or mutation.
- Apply explicit limits to frames, nesting, collections, pending work, peer
  counts, buffers, and queues. Bound memory independently of peer claims and
  swarm size; backpressure is correctness, especially on mobile hardware.
- Never panic on malformed network or metainfo input. Handle unknown
  extensions and unsupported behavior explicitly.
- Keep enough error context to identify the peer, message, and violated
  contract without dumping payloads.

Use distinct types for hashes, indices, offsets, lengths, and identifiers when
they prevent realistic confusion.

## Data Integrity And Storage

Piece verification is the authority for content validity. Storage code
accounts for short reads and writes, partial files, truncation, out-of-space,
permissions, removal, concurrent access, crash recovery, and platform
lifetime rules. Desktop path semantics do not transfer to Android SAF or Apple
security scopes.

## Performance

Make buffer ownership understandable before eliminating copies; each hot-path
copy should have a known purpose. Measure before claiming performance or adding
complexity, and keep realistic benchmarks and traces when they answer a
specific question.

## Observability

Structured events and tracing follow important work with stable identifiers
for the torrent, peer, piece, block, and owning component, and reveal state
transitions and causes, requests, timeouts, retries, cancellations, protocol
rejections, and relevant scheduling and storage decisions. Logs are not the
product state API: clients consume commands, snapshots, and events. Do not log
payload bytes, secrets, or unbounded peer-controlled strings, and keep
high-volume diagnostics controllable.

## Testing And Evidence

Prefer deterministic tests that run without the public Internet, at the
cheapest layer that proves the behavior:

1. unit tests for values, codecs, invariants, and state transitions;
2. property or fuzz tests for parsers and stateful edge cases;
3. scripted peers for fragmentation, invalid input, reordering, timeout, and
   disconnect;
4. interoperability against libtorrent and other mature clients;
5. controlled real-swarm exercises where simulation is insufficient; and
6. validation on desktop and physical Android/ChromeOS.

[`topics/protocol-support.md`](topics/protocol-support.md) records which
evidence backs each protocol claim.

## Changing Engine Behavior

Before changing a protocol or storage capability, study its complete
behavioral shape: the specification, the pinned libtorrent implementation and
tests, and known product failures. Handle the cases that would force a
different state model, owner, persistence format, integrity boundary, resource
limit, or interoperability contract if discovered later: fragmented and
reordered messages, duplicate or late data, cancellation and restart,
cross-file pieces, skipped files, corrupt durable state, extreme but accepted
sizes, and transitions between modes. Defer unrelated breadth and optional
policy explicitly rather than building it speculatively.

Before adopting a dependency, weigh its scope, maintenance, target support,
license, transitive weight, and whether it would own behavior that belongs to
the engine.

## Review Questions

- Who owns this state and its invariant?
- Can the important behavior be tested without unrelated infrastructure?
- What bounds peer-controlled memory, queues, and work?
- Who cancels and joins this task?
- Can one component fail without leaving another inconsistent?
- Which hostile, interrupted, or transition cases would change this state
  model if added later?
- Can diagnostics explain why this transition occurred?
- Does an abstraction solve a current problem or only anticipate one?
- What evidence justifies saying this feature is supported?

When evidence changes one of these principles, update this document rather
than quietly accumulating exceptions.
