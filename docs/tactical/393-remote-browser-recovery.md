# Remote browser recovery

Status: implemented and locally verified, 2026-11-15. Not deployed.

## Scope and stopping condition

Repair the hosted controller after phone backgrounding, socket loss and
silent stalls. Keep the current document and saved browser authorization;
recover live views without page navigation or password re-entry. Finish with
focused transport/recovery evidence, web typecheck/unit checks and a commit.

No host protocol, engine, Android native boundary, authorization lifetime,
cache policy, service worker, offline presentation or deployment changes.

## Investigation and reference behavior

Compared the sibling YepAnywhere paths:

- `packages/client/src/lib/connection/ConnectionManager.ts`
- `packages/client/src/lib/connection/{resumeErrors,remoteErrors}.ts`
- `packages/client/src/contexts/__tests__/RemoteConnection.recovery.test.tsx`
- `docs/tactical/136-recoverable-remote-connections.md`

Adopt its separation of network loss from verification failure, preservation
of credentials, foreground health checks and in-place bounded recovery. No
source or fixtures are copied. Unlike its encrypted ping, use JSTorrent's
existing read-only remote inspection request; no new wire call is needed.

JSTorrent currently reloads the document 250 ms after ordinary socket loss.
Chrome Android can then restore a scriptless offline snapshot if navigation
fails while the network returns. Removing that routine navigation addresses
the app-owned trigger; it does not claim to disable Chrome's snapshot feature.

## Ownership, bounds and invariants

- The application view controller remains the sole retry owner, with its
  existing 250 ms to 30 second backoff. Remote transport owns only liveness
  detection and connection termination, never a parallel reconnect loop.
- Each open remote transport owns one health interval, browser wake listeners
  and at most one inspection probe. All terminate with that transport.
- Visible connections without incoming records for 45 seconds close for
  recovery. Foreground probes allow two seconds; hidden pages do not probe.
  Host view streams already emit empty batches at most 20 seconds apart.
- Socket errors, closes and handshake timeouts are retryable, including after
  a host greeting. They cannot erase browser authorization. The current wire
  cannot authenticate a revocation rejection before resume establishes keys.
- Identity/proof/record failures remain blocking. Propagate that terminal
  evidence into the application retry owner without automatic navigation.
- Never replay application commands; reconnect restores view subscriptions.
  Direct-file peers still terminate with their parent circuit.
- The login gate owns only initial acquisition. Five rapid attempts can be
  followed by visible thirty-second probes or foreground/network hints.
  Editing credentials and unmounting cancel that initial recovery. This
  owner disappears when the live application's view owner takes over.

## Validation

Exercise interruption during resume, stalled visible connections, foreground
checks, overlapping wake signals, teardown, verification failures, retained
credentials and view recovery without document reload. Run the complete web
typecheck and unit suite. Use the separate test Chromium for browser evidence;
do not touch the primary browser or the user's phone.

## Results

- `npm run typecheck --prefix clients/web`: passed.
- `npm run test --prefix clients/web`: 979 passed, three skipped and three
  existing failures in `src/compat/window.test.ts` on 2026-11-15. An isolated
  `git archive HEAD` baseline reproduces all three failures: stale known-break
  exceptions, the retired Download all fallback and the strict-client hold.
  Compatibility retirement is intentionally left to its own reviewed change.
- `VITE_RSTORRENT_REMOTE_RELAY_URL=wss://relay.rstorrent.com/client
  VITE_RSTORRENT_REMOTE_BUILD_ID=recovery-validation npm run build:remote
  --prefix clients/web` (after sourcing `scripts/dev-env.sh`): passed,
  including the Wasm build and CSP bundle check.
- `node scripts/check-localization.mjs`: passed; existing translated startup
  and explicit authentication-failure messages are reused.
- `node scripts/verify-remote-recovery.mjs`: passed at 1365 and 390 pixels.
  Real gate/IndexedDB/transport/view owners/UI retain a typed add-torrent
  draft and document identity across network outage and CDP renderer freeze
  followed by an unanswered foreground probe. Changed-host verification
  stops recovery; saved authorization remains present.

The focused transport/gate cases also cover failed sends, timeout versus
invalid proof, initial retry exhaustion and online recovery, probe coalescing,
hidden quiescence and timer/listener teardown. Reusable protocol fixtures are
extracted from existing JSTorrent tests, not imported from another project.
The real-host verifier's reload expectations were updated, but that full
native-host/relay runner was not executed. No Rust source or protocol changed;
workspace Rust checks, physical-phone testing and publication were not run.
