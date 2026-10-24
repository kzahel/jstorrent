# Tactical 262: Android Network Status Presentation

Status: Complete, 2026-10-08. Bounded Android presentation/signing checkpoint.

Topics: `client-surfaces`, `web-ui-design`, `localization`.

## Scope, invariants and stopping condition

Network Settings directly renders generated `ListenerStatus` and
`PortMappingStatus` through Kotlin `toString()`. Singleton variants inherit
class-name rendering, including the internal `org.rstorrent` namespace, and
structured variants expose implementation-shaped text. Replace those two
presentation paths with exhaustive localized descriptions. Preserve meaningful
listener address/port, mapped address/port/lease and failure/uncertain-cleanup
facts. Keep raw implementation names out of feedback's message-less failure
fallback as well; retain actual error messages and local diagnostics.

No engine, listener/mapping/background policy, generated DTO/ABI, wire/version,
identity, signing, persistence, task or dependency change. The existing Compose
owner consumes the same authoritative settings view. UI resources depend on
semantic view facts; Rust does not depend on localized text.

Complete when actual old/new Android Network screens and the existing Compose
navigation/affected Android/catalog checks pass. Rebuild the final signed
Android candidate and inspect its resolved release identity afterward. Earlier
endurance/migration receipts retain their exact source and component scope.

## Validation and execution

Use the existing owned-AVD factory/probe helpers, which refuse replacement of
an existing AVD, capture only task-created app state and reap/delete the owned
emulator after each prepared check. Keep before/after assets ignored under
259's report directory. Add a proportional Compose regression for disabled
status rendering and retained failure/cleanup facts. The two active physical
background observations are not interrupted for presentation inspection.

Restart checkpoint: source-generated variants and both direct rendering sites
are reviewed. No reference implementation or asset is imported; this is Android
presentation of unchanged application facts. Old isolated APK is ready for a
bounded before capture; replacement implementation and validation follow.


## Implemented presentation and first validation

Actual owned API-35 captures reproduce both `org.rstorrent` singleton names in
the pre-fix isolated APK and show their absence in the updated native screen.
Listener and all router states now use 23 Android catalog resources, preserving
IPv6 address/port, failure reason/stage/detail, local/external endpoints and
finite uncertain cleanup lease. Message-less feedback failures use the existing
localized preview fallback. Generated binding, engine and policy are unchanged.

The new Compose case passes disabled-copy, listener endpoint and cleanup-lease
facts plus address-in-use detail. The initial full navigation run passes 22/24;
two existing torrent fixtures incorrectly retain the default checking-storage
flag and therefore deliberately hide their rows. Those fixtures now declare
completed storage checking. All 24 navigation cases pass on a new owned API-35
AVD; captures and test emulators are reaped/deleted afterward. The generated
Kotlin cache is ignored alongside Gradle caches. All localization checks and
2,036-value/40-original-asset branding checks pass; debug APK assembly and
whitespace checks pass. Exact logs/captures remain in the ignored report path.

Restart checkpoint: commit presentation and qualification fixtures; rebuild
normal release with the original upload certificate, independently inspect the
final APK/AAB, then run bounded legacy ordinary/companion upgrade rehearsals.
The earlier source-184 signed capsule is historical and must not be uploaded
as the final candidate after this correction.


## Final original-key release checkpoint

Normal production release from `37673687f15235840f3ac47ab044f2cd3e2f2445`
passes both ABI builds/generated binding, 121 release JVM cases (zero failed,
errors or skipped), release lint and independent validation with pinned
bundletool. Package remains `com.jstorrent.app`, 1.0.26/code 26, API 28/target 36,
original upload certificate, one retained launcher alias, both ABIs, 16-KiB
ELF/ZIP alignment and complete notices. No store upload is performed.

Final AAB SHA-256:
`428b8ccbb9330b30ec44799a1f9d336d85a355a3c51b4fa695249c4e28e66b46`.
Final APK SHA-256:
`121bbe514138c1202d459605cb35732be23350f78c42c1d83946877b8a3a1bc7`.
The original-signed production APK also passes actual owned API-35 launch,
disclosure, Network navigation and clean disabled-status capture. Its task AVD
is shut down/deleted. The exact artifacts and receipts are retained in ignored
259 evidence. The concrete internal-track review supersedes source-184.

Stopping condition is met. Wider current ordinary/companion installed rehearsals,
physical lifetime checks, Play/Web Store delivery and cutover remain Tactical
259 gates; this presentation checkpoint does not qualify them.
