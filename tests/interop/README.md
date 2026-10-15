# Controlled engine and application scenarios

These harnesses use independent fixtures and pinned Python libtorrent as a
peer. They exercise real sockets, storage and process lifetimes beyond unit
tests. Use the map to select a failure or contract; it is not a list to run in
full after every change. [Validation overview](../../docs/development/testing.md).

## Running a scenario

From the repository root:

```bash
source ~/.profile
uv sync --project tests/interop --locked --python 3.12
cargo build --locked -p rstorrent-gateway -p rstorrent-session
uv run --project tests/interop --locked \
  python tests/interop/application_lifecycle_smoke.py --help
uv run --project tests/interop --locked \
  python tests/interop/application_lifecycle_smoke.py \
  --binary target/debug/rstorrent-gateway
```

Replace the script with the scenario below. For runners with help, use `--help`
for binary, fixture, repetition and output options. Runners marked **†** have
no help handler: read their linked entry point for defaults/arguments instead
of passing `--help`, which may start a run. Some scenarios need additional
builds or web assets. The locked environment pins Python 3.12 and libtorrent 2.0.13.
Scripts own their temporary profiles, content and child processes; retained
reports/captures are explicit local artifacts to remove after review.

## Integrity, storage and persistence

| Question | Scenario |
| --- | --- |
| Do released and current hosts and clients still work together end to end (connect, set the download folder, download, verify, remove with data)? | [compat_live_matrix.py](compat_live_matrix.py); every pair from `compat/deliveries.json` by default, or `--host` and `--client` with `current` or a commit. Old hosts are built once into `target/compat-live/`. Also the `Compatibility live matrix` workflow. |
| Does ordinary intake, restart, seeding, corruption repair and keep-data removal work? | [application_lifecycle_smoke.py](application_lifecycle_smoke.py); `--extended` adds oversized and folder cases |
| Is the first verified piece correct under failure and bounded buffers? | [first_verified_piece.py](first_verified_piece.py); `--large-piece` and `--selective-files` exercise storage geometry |
| Does the finite downloader handle selection, recheck, crash, locks and permissions? | [stateless_foreground_download.py](stateless_foreground_download.py); build release `rstorrent-download` first |
| Is selective hashing bounded, including steady-state work? | [selective_hash_profile.py](selective_hash_profile.py); `--profile steady` |
| Are durable checkpoints correct and safe at forced-death boundaries? | [session_checkpoint_profile.py](session_checkpoint_profile.py), [session_checkpoint_crash.py](session_checkpoint_crash.py); `--scenario all` |
| Does unified resume/recheck recover correct content and reject stale authority? | [session_resume.py](session_resume.py), [unified_resume_recheck.py](unified_resume_recheck.py); `--phase all` includes crash cases |
| Do pure-v2 and hybrid transfers interoperate in both roles? | [pure_v2_runtime.py](pure_v2_runtime.py), [hybrid_runtime.py](hybrid_runtime.py) |

## Discovery, transfer and scheduling

| Question | Scenario |
| --- | --- |
| Does DHT discover peers and handle incoming queries/announcements? | [dht_magnet.py](dht_magnet.py) **†**, [ipv6_dht.py](ipv6_dht.py) **†** |
| Can an independent peer discover a seed through trackers/TCP and DHT/uTP? | [advertised_seeding.py](advertised_seeding.py) **†**, default controlled mode |
| Does a permanently choked peer leave useful peers able to finish? | [multi_peer_liveness.py](multi_peer_liveness.py) **†** |
| Can incomplete selective content download and upload simultaneously? | [incomplete_duplex.py](incomplete_duplex.py) **†** |
| Do live listener/settings changes persist and recover bind conflicts? | [client_settings_restart.py](client_settings_restart.py) **†** |
| Do seed admission and durable goals preserve limits and restart behavior? | [seed_admission.py](seed_admission.py) **†** |
| Does the application use uTP and cleanly recover/fall back? | [utp_product_integration.py](utp_product_integration.py) **†** |
| Are MTU, loss and long-RTT behavior correct? | [utp_runtime_impairment.py](utp_runtime_impairment.py) **†**; `--product-mtu`, `--efficiency`, `--long-rtt`; [utp_runtime_long_rtt_product.py](utp_runtime_long_rtt_product.py) **†** |
| How does concurrent throughput/resource use change, and do rate limits hold? | [multi_torrent_throughput.py](multi_torrent_throughput.py); `--rate-policy` checks session/torrent caps and fairness |

## Application and browser integration

These scenarios also require web dependencies and the project's Playwright
Chromium. Use the dedicated test browser, not the primary installed browser.

| Question | Scenario |
| --- | --- |
| Do local torrent bytes reach the ordinary application correctly? | [browser_torrent_file_intake.py](browser_torrent_file_intake.py) **†** |
| Does the browser control a hybrid transfer through restart and selection? | [browser_hybrid_runtime.py](browser_hybrid_runtime.py) **†** |
| Do peer/file views, reconnect, disk pressure and piece-map recovery work? | [browser_peer_inspection_surface.py](browser_peer_inspection_surface.py); `--disk-pressure`, `--piece-map`, optional `--screenshot-dir` |
| Does an active file stream safely while the torrent remains incomplete? | [incomplete_file_streaming.py](incomplete_file_streaming.py); drives the browser and verifies incomplete-content HTTP behavior |
| Do tracker countdowns decrease through unrelated updates, reopen and reload? | [tracker_countdown_surface.py](tracker_countdown_surface.py) |
| How many application-view bytes does the UI transfer? | [application_ui_bandwidth.py](application_ui_bandwidth.py); application/WebSocket measurements, not TLS/IP or billed traffic |

## Platform integration

Use explicit owned devices or task-owned emulators; defaults and build
prerequisites belong in script help and [platform guides](../../docs/development/clients.md#platform-validation).

| Question | Scenario |
| --- | --- |
| Does Android SAF repair preserve paused/running intent and correct bytes? | [android_saf_repair_intent.py](android_saf_repair_intent.py); fresh API 35 AVD and a new output directory |
| Does Android expose uTP MTU/reachability policy correctly? | [android_utp_path_mtu.py](android_utp_path_mtu.py), [android_utp_reachability_status.py](android_utp_reachability_status.py) |
| Does ChromeOS sustain controlled Android/Linux transfers and recover roots? | [chromeos_android_qualification.py](chromeos_android_qualification.py), [chromeos_android_recovery.py](chromeos_android_recovery.py), [chromeos_crostini_qualification.py](chromeos_crostini_qualification.py) |

ChromeOS qualification requires Machine Control and isolated staged packages;
the Android identity is `org.rstorrent.qualification253`. These are controlled
runtime checks, not real Play delivery. A short observation does not establish
the full endurance cohort. [Tactical 253](../../docs/tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
owns exact staging, observation, restoration and physical gaps.

Legacy Android/desktop import and old/new extension pairing are indexed
separately under [migration testing](../../docs/migration/testing.md).

## Opt-in live and off-LAN evidence

Read the [live-evidence policy](../../docs/topics/performance-and-live-evidence.md)
and owning tactical before running these. They need explicit public-network or
router/off-LAN scope and are not routine deterministic tests.

| Observation | Scenario and required scope |
| --- | --- |
| Public metadata/download and comparison | [public_compare.py](public_compare.py); choose catalog/profile/owner/target explicitly |
| Public uTP readiness | [utp_public_observation.py](utp_public_observation.py); `--allow-public-network`, metadata only |
| IPv6 firewall pinhole and incoming transfer | [ipv6_pinhole_seeding.py](ipv6_pinhole_seeding.py) **†**; `RSTORRENT_OFF_LAN_SSH_TARGET` supplies an operator-controlled verifier |
| Tracker/DHT endpoint advertisement through actual mappings | [advertised_seeding.py](advertised_seeding.py) **†**; `--mapped-external` plus `RSTORRENT_OFF_LAN_SSH_TARGET` |
| Product-owned incoming uTP | [product_utp_reachability.py](product_utp_reachability.py); explicit `--host` off-LAN verifier |

Keep targets and network identities private. A cleaned timeout or unavailable
peer is an evidence limit, not a controlled regression pass. Record measured
resources and cleanup with the actual result; do not append receipts to this map.
