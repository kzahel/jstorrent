# Localized release notes

Optionally add `android-vX.Y.Z.json`, mapping exact Google Play locale codes to
plain-text notes, before dispatching Android Play Publish. Each note must be
nonempty and at most 500 characters. An `en-US` entry, if supplied, must match
the verified changelog notes exactly; otherwise the publisher adds English.
The workflow automatically includes a matching file in the same verified
release transaction. No matching file retains the existing English behavior.

Translate and independently review these release-specific notes with source
fingerprints before committing. Do not reuse one release's notes for another
or edit tracks merely to publish marketing translations. Production listing
text is owned by `distribution/store-listings`, not this directory.
