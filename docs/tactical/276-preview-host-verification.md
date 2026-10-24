# Tactical 276: Preview Host Verification

Status: Complete bounded qualification, 2026-10-08.

Topics: `remote-access-authentication`, `product-surfaces-and-migration`.

## Scope and stopping condition

The explicitly approved source8c push schedules the existing private preview
deployment. Its candidate verifier fails HTTP403 before activation: direct
loopback requests name the transport address instead of the configured public
Host. Correct only the verification client to send the configured authority
for static, health and WebSocket requests. Stop after an actual isolated gateway
accepts the correct credential/Host and rejects wrong Host/missing credentials,
then the approved source8c preview is activated and independently verified.

Read Tactical076 and `remote-access-authentication`. Preserve exact gateway
Host/Origin and credential checks, original source8c shipping bytes, public
production delivery and inherited preview state. No authentication policy,
new origin, signing input or public release is authorized by this correction.
Private deployment paths/credentials and receipts stay in ignored evidence or
the existing private infrastructure source. A later local verifier commit does
not authorize pushing a different application source.

## Validation and ownership

Run the corrected verifier against the actual approved-source release gateway
in an owned temporary profile/storage with a temporary bounded credential.
Join its process and remove its temporary roots. The existing private deploy
worker retains its candidate-before-activation checks and rollback ownership.
Record exact preview source/build identity, activation result and cleanup;
do not infer desktop artifact or production website acceptance from preview.

## Actual evidence and completion

The first corrected header-only attempt still fails403: Node fetch does not
preserve its supplied Host. This failure stays recorded. The HTTP/HTTPS client
now supplies the configured Host with an overall ten-second deadline and8-MiB
body bound; WebSocket likewise names that Host. Actual approved-source8c
release gateway checks pass static/module, exact health/build ID and API-v1
WebSocket; wrong transport Host403 and correct Host without credentials401
remain. The temporary gateway exits0 on terminate and its roots are removed.

The existing private worker supports one invocation-scoped verifier override
so the approved source8c build stays exact while using the corrected checker.
Its owned retry passes gateway tests,470 web tests, types/build/CSP and staged
verification, activates source8c, then verifies private listener and public
HTTPS static/health/WebSocket. Worker exits0 and records deployment success.
No different application source is pushed, no authentication policy changes,
and no production website/store/feed is activated by this preview correction.
Ignored exact-source receipts retain both earlier failures and this completion.
