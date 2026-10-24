# Tactical 268: Android Visible Error Fallback

Status: Complete locally, 2026-10-08. Bounded branding follow-up to 259.

Topics: `client-surfaces`, `localization`.

## Scope and stopping condition

Message-less native exceptions currently fall back to `Throwable.toString()`
in visible Android errors and retained reset details. That can expose internal
`org.rstorrent` class names in the product UI. Use a catalog-owned English
fallback when the exception message is absent or blank; preserve meaningful
messages and complete technical logs. Do not rename internal package identities,
filter user input, change exception classification, or change engine behavior.

Add one task-free formatter in the existing presentation formatting owner.
No new jobs, queues, dependencies, generated boundary types or cancellation
paths. Complete after meaningful absent/blank/custom-toString/message tests,
localization validation, normal Android builds, and reconciled release evidence.
The product ships English only; pseudo-locales remain layout test catalogs.

## Required evidence

A message-less exception whose technical identity contains `org.rstorrent`
returns the provided localized fallback; meaningful messages survive exactly.
Blank messages also fall back, and custom technical `toString()` is never used.
Normal unit tests, lint and signed packaging must pass. This source-level
regression evidence does not claim that a specific runtime exception was
observed on a device. Physical checks retain exact application-source identity.

## Checkpoint

All localization catalogs pass (469 Android English resources; English remains
the only shipping locale). Debug JVM tests and lint pass through the normal
Gradle variant; the new test covers absent/blank and custom technical identities
as well as exact meaningful-message preservation. Normal original-signed release (122 JVM cases and lint) and independent
APK/AAB package/signature/labels/API/ABI/alignment/notices validation pass.
Latest-source physical acceptance is separately pending under259/267.
