# Tactical 332: Windows Listener Test Port Isolation

Status: Complete locally and on native Windows ARM64, 2026-10-13.
Hosted x86_64/Rust 1.97.0 CI has not been rerun.

Topic: `incoming-reachability-and-seeding`.

## Scope and stopping condition

Repair the sole failure in source CI
[38409973610](https://github.com/kzahel/jstorrent/actions/runs/38409973610):
`application_incoming_bootstrap_is_disabled_or_exactly_fixed` in the Windows
native session suite. Keep the fixed-port conflict, live repair, retained
listener after failed replacement, same-value retry, and joined shutdown
assertions. Stop after focused repetitions, session-library validation,
formatting/lint, and proportional Windows evidence.

Non-goals: production socket allocation policy, protocol or generated-boundary
changes, release/store actions, and changes to unrelated CI jobs.

## Diagnosis and ownership

The test owns an IPv4 TCP blocker on OS-assigned port 50949, then requests
automatic listening with that occupied preferred port. The allocator retries
50950, which Windows refuses with error 10013. The test waits five seconds for
Applied and fails. A free ephemeral port does not establish that its successor
is usable. Error 10048 on the blocked fixed port is intentional evidence.

Inspected `application.rs::application_incoming_bootstrap_is_disabled_or_exactly_fixed`,
`available_port_on`, `wait_for_client_settings`, and
`session_socket.rs::bind_automatic`. The existing automatic policy increments
only on AddressInUse; other errors remain observable failures. Give the repair
step an independently OS-assigned, TCP/UDP-probed preference using the existing
bounded helper. Keep the original blocker until the unchanged fixed retry.

Only test inputs change. Application maintenance owns transport convergence;
the test observes actual status and joins shutdown. No runtime owner, task,
cancellation path, resource limit or dependency direction changes, and no new
protocol/reference behavior is adopted. Android semantics and build contracts
remain unchanged because shipping source is untouched.

## Local validation

The original CI run remains failed; all nine other applicable jobs passed.
The unchanged focused test passes on macOS before repair; the actual negative
evidence is the recorded Windows CI failure. After repair:

- `cargo fmt --all -- --check` passes.
- `cargo clippy --workspace -- -D warnings` passes.
- `cargo clippy --locked -p rstorrent-session --all-targets -- -D warnings`
  passes, including the modified test.
- `cargo test --locked -p rstorrent-session --lib` passes: 394 tests,
  two existing ignores.
- Forty exact-test runs in four concurrent processes pass using the compiled
  session-library test binary.
- `cargo test --workspace --quiet` passes: 1,598 tests, 18 existing ignores.
- Changed-document local links and `git diff --check` pass.

## Windows checkpoint

The Machine Control Windows development appliance starts from powered off;
native ARM64 Rust 1.99.0 and MSVC are already installed. SSH owns the bounded
source transfer and test execution; no desktop interaction is needed.
A disposable source copy retains the ordinary Cargo profile and lockfile;
the modified application file independently matches SHA-256
`68d61c4342e1b0450daa9e8181e220b5c646ff36c6d29cd52a31609986405b3e`.
The exact application regression passes with `cargo +stable test --locked
-p rstorrent-session --lib
application::tests::application_incoming_bootstrap_is_disabled_or_exactly_fixed
-- --exact`. The cold build takes 24m07s with the ordinary optimized profile;
the test passes in 10.14s. Forty exact-test runs across four concurrent
processes then pass. Running the same compiled session-library harness with
`& $binary --quiet` passes its full suite: 392 tests, two existing ignores,
283.77s. The native compiler emits
existing Windows unused-code warnings and Rust 1.99 deprecation warnings;
the pinned local Rust 1.97 formatting/Clippy gates pass as recorded above.

This differs from the hosted x86_64/Rust 1.97.0 environment and cannot establish
full hosted CI success. No push or hosted rerun is performed. The owned native
source/build copy is removed and the appliance returns to its initial
powered-off state. Claim release completes cleanup.
