# Tactical 286: Connected Companion Layout Review

Status: Complete bounded local review, 2026-10-09, beneath finish-line Tactical259.

Owners: web-ui-design, client-surfaces, application-view-api and Tactical284.
Read adaptive navigation and Tactical173's table-scroll contract.

## Scope and stopping condition

Diagnose the clipped narrow connected screenshot from the owned upgrade run.
First distinguish actual layout from a capture during responsive drawer motion.
Require settled narrow/wide bounds in the actual packaged connected page;
fix product presentation only if stable evidence demonstrates a defect. Stop
after the repeat, reviewed screenshots, proportional interaction checks,
cleanup and documentation reconciliation.

Non-goals: new navigation, changing table visibility/data/selection or Android
Compose, engine/migration changes, physical/store delivery and publication.

## Invariants and evidence

The existing 760px drawer and table-owned horizontal scrolling remain the
accepted design. A closed drawer must be outside the narrow viewport while
the main pane fills it. Wait for actual layout and virtual rows rather than
using an arbitrary screenshot delay. Captures may use reduced motion and
disabled animations, as the existing Playwright suite does, and must disclose
that choice. Keep the first screenshot and any failed bounds unchanged.

The current-source owned API35 upgrade must still pass all retained-root,
payload/restart and fresh companion-control assertions. Capture390/1100 with
measured main/drawer bounds, interact with the narrow filter drawer, keep
table overflow inside its scroll owner and show before/settled results.
Join/delete the owned browser/emulator and restore incubation outputs.

The first settled repeat passes upgrade/restart/control and measured390/1100
bounds. A later interaction repeat fails in the unchanged old client's tracker
writer before replacement, despite a recorded announce request. Its HTTP client
asks for Connection: close, so HTTP/1.1 alone cannot eliminate the fixture EOF
race. Retain that failure and allow a bounded 100ms response drain after flushing
the local fixture body, without changing product code or source state.

## Result and remaining scope

The apparent clipping is a screenshot taken during the existing drawer
transition, not a settled product-layout defect. Captures now use reduced
motion/disabled animations and await actual main/drawer/document bounds.
At 390px, the main spans 0–390, document width is 390 and the closed drawer ends
at -13.6px. At 1100px, the wide drawer spans 0–210 and main spans 210–1100. The
final repeat opens/closes the narrow filter drawer through the actual button,
captures it visibly within the viewport, and preserves the imported library.
Table columns retain their own horizontal scroll owner. No product CSS,
navigation, state or copy changes are necessary.

Two settled repeats and the earlier successful run each pass the three existing
upgrade/restart/control assertions. The final repeat uses the bounded tracker
drain window and passes. All failed fixture attempts remain separate evidence;
this is not a claim that every old-client connection is reliable. Current
wide captures include the Peers panel's initial loading state; no stuck-loading
or missing-design claim is inferred from that frame. Before/settled images are
visually reviewed and shown to the maintainer. JavaScript/Python syntax and
diff checks pass. Each run removes its browser/emulator/server state, deletes
the AVD and restores ordinary incubation builds. Physical/Play and exact signed
production package qualification remain under259.
