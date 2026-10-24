# Agent pull-request review

The custom review lane runs the pinned Codex CLI against an isolated PR
checkout, using an externally managed HTTPS inference gateway. The URL, gateway
token and network enrollment identity live in GitHub configuration, never in
this public repository. Provider login, refresh ownership, service deployment
and private infrastructure inventory belong in the maintainer's dotfiles
runbook `runbooks/agent-pr-review.md`.

## Trigger and authority

`.github/workflows/agent-review.yml` executes its controller from trusted main
after a successful completed `Fast CI` pull-request workflow, or manual dispatch
with a PR number. Both the job condition and controller reject failed,
cancelled, skipped, incomplete and wrong-workflow automatic events. Full
platform qualification is independent and may still be running. Tactical
[304](../tactical/304-fast-pr-feedback-and-ci-benchmarks.md) owns the early
feedback lane and benchmark evidence.
It accepts only open, non-draft PRs authored by the maintainer's stable GitHub
user ID, from this repository, targeting main. The controller checks the live
GitHub PR and exact triggering head SHA; superseded results are skipped. The
publisher independently rechecks eligibility and pins its COMMENT review to
the reviewed commit. It cannot approve or merge.

Explicit manual dispatch can qualify a PR while `AGENT_REVIEW_ENABLED=false`.
That switch controls automatic reviews and trusted main cache warming; manual
dispatch still enforces every PR eligibility and publication check.

The review job has contents/actions/PR read permission and an OIDC permission
for ephemeral network enrollment.
Subnet-route acceptance is disabled immediately after the pinned Tailscale
action joins, before gateway use; the action itself hardcodes route acceptance.
The tag's network grant permits only the gateway throughout enrollment.
The workflow verifies the gateway's unauthenticated 401 boundary before review.

The publishing job has PR write permission and receives only bounded JSON
output. No credentials, PR checkout or build
cache crosses into the publisher. Titles, bodies, commands, paths and line
numbers are treated as untrusted output; the validator checks shape, sizes,
priority and location against GitHub's right-side PR diff before posting.
The exact `/workspace/` container prefix may be stripped from a finding path;
the remaining filename and line must still appear in that diff. Other absolute
roots, traversal and unknown files are rejected.
Large/truncated patches without an available GitHub patch cannot receive inline
findings; the validation fails instead of silently attaching an unverifiable
location.

## Execution boundary

The Dockerfile pins Node/Rust base-image digests, Rust 1.97.0, Node 24.18.0 and
Codex 0.160.0. Dependency preparation runs without model credentials or tailnet
access. Review runs as a non-root user with dropped capabilities, no host home
or Docker socket, a read-only image and `--network=none`. The submitted checkout
and per-run cache are writable for builds and repros. Trusted prompt, schema,
context and Unix socket mounts are read-only.

A proxy outside the container holds the revocable gateway token and accepts only
Responses, compaction and model-catalog routes for one configured HTTPS gateway.
It substitutes authorization, rejects redirects and upgrades, streams responses,
and propagates cancellation. The inner loopback bridge carries requests over
the mounted Unix socket. The container receives a non-secret placeholder token.
No provider credential is copied into GitHub or the review container.

The model uses high reasoning effort and may inspect relevant code, build,
test and create small repros. Existing fast-check conclusions are context,
not a claim that full qualification or additional checks ran. Live/public-swarm
work and complete platform matrices
are excluded. The time limit is 25 minutes; execution is bounded to 8 GiB RAM,
four CPUs and 512 PIDs. The gateway proxy permits at most 512 requests per run,
32 MiB request bodies, 16 KiB headers and ten-minute stream idle time. This does
not establish a usage or monetary budget.

Only a trusted main push warms and saves the Rust target and dependency cache;
review jobs restore but never save. Cache keys include the pinned container
recipe and main lockfiles. A cold run can still require compilation; an agent
may report offline dependency or platform limitations instead of guessing.

## Configuration and readiness

Required GitHub configuration:

| Name | Kind | Purpose |
| --- | --- | --- |
| `AGENT_REVIEW_ENABLED` | variable | Automatic review/cache activation, default false |
| `AGENT_REVIEW_AAR_URL` | variable | HTTPS gateway ending in `/codex` |
| `AGENT_REVIEW_MODEL` | variable | Account-supported model; initial `gpt-6.1-sol` |
| `AGENT_REVIEW_AAR_TOKEN` | secret | Revocable inference-only gateway token |
| `AGENT_REVIEW_TS_CLIENT_ID` | variable | Tailscale GitHub OIDC identity |
| `AGENT_REVIEW_TS_AUDIENCE` | variable | Generated OIDC audience |

The home service and HTTPS route were installed on 2026-10-11; its Linux build,
typecheck and all 136 router tests passed. Unauthenticated HTTPS requests return
401 without inference. The restricted tailnet policy was saved on 2026-10-11;
Tailscale accepted its embedded access tests. Dedicated ChatGPT login succeeded;
Codex 0.160.0's official helper persisted replacement credentials through
`aar renew pr-review`. The authenticated catalog includes `gpt-6.1-sol`;
concurrent catalog reads and a catalog read after service restart succeeded.
This verifies forced renewal, not an observed natural-expiry cycle. The scoped
GitHub OIDC trust was created and its client ID/audience variables verified on
2026-10-11. The explicit hosted qualification succeeded against
[sample PR 25](https://github.com/kzahel/rstorrent/pull/25) in
[run 38136308656](https://github.com/kzahel/rstorrent/actions/runs/38136308656).
The review and publishing jobs passed with automatic activation still false.
The reviewer found the deliberately introduced inclusive-deadline bug and
reported the focused Node check's expected two passes and one failure. The
publisher posted a COMMENT review and an inline finding on line 3, both bound
to head `cfc582203ac0baecedf4cfc9d082dd2281864e65`.

This initial sample qualifies real inference, hosted OIDC enrollment, container
execution and commit-bound publication. Its normal CI was cancelled to keep
qualification bounded; this is not full platform/build evidence.
The temporary sample PR was retired without merging on 2026-10-24. Its
[review](https://github.com/kzahel/jstorrent/pull/25#pullrequestreview-5483172476)
and [inline finding](https://github.com/kzahel/jstorrent/pull/25#discussion_r4241441872)
retain the qualification evidence; the deliberately failing fixture stays out
of the product.

After [PR 26](https://github.com/kzahel/jstorrent/pull/26) passed full
qualification and merged, automatic review/cache activation was enabled.
The first successful focused Fast CI event for
[probe PR 27](https://github.com/kzahel/jstorrent/pull/27) automatically starts
[review 38149228310](https://github.com/kzahel/jstorrent/actions/runs/38149228310).
The review and publisher pass in 6m03s, bound to head
`3a7d2b4bdb6f48754b747cf596144ad1e9bddbec`. The reviewer builds and runs all
ten focused engine identity tests offline and reports no introduced bugs.
Its separate container build cache misses. Trusted-main warming subsequently
compiles locked workspace tests in 23m05s and saves a 2.25 GB cache. Repeat
[review 38150705796](https://github.com/kzahel/jstorrent/actions/runs/38150705796)
restores that exact cache in 37s and publishes against `abc14750`, reporting
all ten focused identity tests passing offline. It completes in 7m21s; this
pair establishes cache reuse, not a review-latency improvement. The image lacks
rustfmt, which the review reports explicitly; Fast CI provides formatting
evidence. Installing reviewer
format/lint components is a bounded tooling follow-up, not a claim that they ran.
The repeat also reports an absent shell profile and Rust login-shell PATH;
sourcing `/usr/local/cargo/env` recovers. Supply a predictable reviewer shell
environment in the same tooling follow-up.
Tactical 304's [evidence](../evidence/304-fast-ci-benchmarks-2026-10-11.md)
distinguishes queue delay, fast-job runtime and reviewer-cache state.

OpenAI documents API keys as the automation default and explicitly excludes
public/open-source repositories from its advanced subscription-auth CI recipe.
This custom gateway is an experimental maintainer integration, not a claim of
supported subscription CI. See the [official advanced auth guidance](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

## Verification and operation

```bash
node --test .github/agent-review/review.test.mjs
actionlint .github/workflows/agent-review.yml
docker build -t rstorrent-pr-review:ci .github/agent-review
# Linux Docker host: fake upstream only, no provider login/inference.
node .github/agent-review/docker-smoke.mjs
# Explicit manual qualification or review, even with automatic reviews off:
gh workflow run agent-review.yml --ref main -f pr=NUMBER
```

The four synthetic tests passed on 2026-10-11. Workflow lint and whitespace
checks passed. The pinned image built on both macOS Docker (arm64) and the
Linux host (x86_64), with the expected Rust/Node/Codex versions. The Linux
Docker boundary smoke passed with the real CLI and fake SSE upstream, without
provider login or inference.

The synthetic tests cover author/fork/draft/stale gates, output/location bounds,
auth substitution, route denial, redirects, streaming, and request limits. The
Linux smoke exercises the actual CLI through the Unix bridge against a fake
Responses stream, checks network/secret/Docker-socket isolation, and cleans up
its container and temporary directory. The hosted qualification also verified
the private gateway's unauthenticated 401 boundary and ephemeral-node removal.
Initial live attempts exposed the action's duplicate subnet-route flag and
absolute finding paths; both were corrected before the successful run. The
sample review reported an absent container shell profile, but its installed Node
executable ran the focused checks. The focused Rust identity build/test is now
hosted-qualified; trusted-main workspace test compilation and cache saving are
also qualified, and the repeat review verifies exact-key cache restoration.
A review failure is advisory and does not replace required CI.

Disable new runs with `AGENT_REVIEW_ENABLED=false`; revoke the gateway token and
OIDC identity separately when retiring access. No automatic retry or fallback
changes provider authentication ownership.

## Canonical repository rename

Tactical [305](../tactical/305-canonical-jstorrent-repository.md) retargets the
controller and workflow to `kzahel/jstorrent`. The Rust repository ID is
unchanged; owner/main/head-SHA and fork rejection stay exact. The retargeted
OIDC identity passes the authentication-only canary and the automatic probe
review under the same private network/tag/scope restrictions. Automatic review
is enabled; provider authentication remains owned by the persistent home router.
