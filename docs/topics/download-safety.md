# Download Safety

Topic: `download-safety`

Status: Implemented in Tactical
[373](../tactical/373-file-selection-bitmaps-and-download-safety.md); local
qualification and remaining platform gates are recorded there. No release is
implied. Safety is host-owned selection policy, separate from priority,
verification, repair quarantine, and operating-system origin labels.

New torrents capture a resolved, versioned rule snapshot before metadata.
Recommended (default on) skips applications, installers, scripts and shortcuts;
Archives adds common archive extensions; Custom accepts up to 128 literal
case-insensitive dot-prefixed suffixes of 2–32 ASCII bytes. `.app` matches
bundle directory components, including the torrent root. ISO images and ZIP
archives remain allowed by Recommended. Rules neither scan malware nor inspect
archive contents. Existing catalogs and legacy imports retain their selections;
changing global rules affects future adds only. Duplicate intake retains the
surviving torrent's rules and explicit allowances.

Download all and ordinary High/Normal selection remain subject to the captured
rules. Files reports the matched extension and preset independently of the
effective selection. Download anyway records an explicit durable allowance and
ordinary wanted intent while retaining High priority; undo re-applies the rule.
Neither action resumes paused work or deletes existing bytes. An allowance
retains a download queue turn so already verified shared-piece bytes can be
promoted from the part file after resume/restart. All-excluded work stays idle
with no files selected. Legacy Download now cannot implicitly override a rule.
Both direct-path and platform-storage magnets reload resolved selection after
metadata acceptance before opening payload storage.

SQLite schema 29 stores canonical LSB-first packed exception, High, allowance,
and cached match masks. The existing wanted/skipped default remains independent.
Trailing zero bytes are omitted; an empty BLOB is the empty set. Each mask is
bounded at 46,875 bytes / 374,998 file indices, rather than 4,096 exceptions.
Metadata-bound matching and summary counters are computed transactionally at
intake/metadata/override boundaries, with a content fingerprint check. Malformed
or missing masks fail closed. See the [migration ledger](durable-data-migrations.md).
Web and Android selection drafts also use two bounded bitmaps; API operations
retain 4,096 indices or normalized ranges per command. Contiguous selections
of thousands of files use a single range. Paged Files remains the UI authority.
Legacy full command snapshots retain their bounded index-array representation;
new web decoders accept the gateway's existing 16-MiB response ceiling. Many
large catalogs can still exceed that legacy response ceiling; the leased-view
API remains the scalable inspection surface.

The independent default-on origin-label preference applies when payload files
are opened for writing on Windows/macOS, where the destination supports it.
Windows writes Zone.Identifier Internet zone and preserves existing Internet/
Restricted-zone labels and provenance. macOS creates com.apple.quarantine and
marks enclosing `.app` bundles within the content boundary. Existing labels
are never stripped when disabled, and private URLs are not invented. Read-only
verification on upgrade does not relabel user files. Failures produce the
structured `internet_origin_marking_failed` warning and do not claim marking
succeeded. Part files and Android SAF descriptors are not labeled. Unsupported
platforms do not claim this OS integration.

React, Compose and SwiftUI expose safety settings and per-file explanations/
overrides. Native mobile clients do not show a Windows/macOS marking switch.
Remote web copy explicitly scopes that switch to supported hosts/filesystems.
New commands require `file_safety`; `file_selection_bitmaps` advertises the
larger selection storage. Released priority values remain unchanged. Optional
output fields preserve missing-field defaults; strict released decoder exposure
is reviewed under the existing client-first release hold. No release/push or
fallback-removal authorization follows from this work.
