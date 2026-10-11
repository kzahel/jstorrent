package org.rstorrent.bootstrap

import java.nio.charset.StandardCharsets

internal const val MAX_EXTERNAL_INTAKE_DESCRIPTORS = 8
internal const val MAX_EXTERNAL_SOURCE_BYTES = 16 * 1024
internal const val MAX_EXTERNAL_DISPLAY_LABEL_BYTES = 256
internal const val BITTORRENT_MIME_TYPE = "application/x-bittorrent"
internal const val EXTERNAL_VIEW_ACTION = "android.intent.action.VIEW"

enum class ExternalIntakeKind {
    MAGNET,
    TORRENT_FILE,
}

enum class ExternalIntakePhase {
    RECEIVED,
    QUEUED,
    PRESENTED,
    AWAITING_ROOT,
    SUBMITTING,
    RETRYABLE_FAILURE,
}

internal enum class ExternalIntentRejection {
    MISSING_DATA,
    SOURCE_TOO_LARGE,
    UNSUPPORTED_SCHEME,
    NESTED_OR_OVERRIDDEN,
    MISSING_READ_GRANT,
    UNSUPPORTED_CONTENT,
}

internal data class ExternalIntentInput(
    val action: String?,
    val data: String?,
    val scheme: String?,
    val mimeType: String?,
    val path: String?,
    val hasSelector: Boolean,
    val hasClipData: Boolean,
    val packageOverride: String?,
    val hasReadGrant: Boolean,
)

internal sealed interface ExternalIntentClassification {
    data object NotExternalView : ExternalIntentClassification

    data class Rejected(val reason: ExternalIntentRejection) : ExternalIntentClassification

    data class Magnet(val source: ExternalIntakeSource) : ExternalIntentClassification

    data class Content(
        val source: ExternalIntakeSource,
        val announcedMimeType: String?,
        val pathHasTorrentSuffix: Boolean,
    ) : ExternalIntentClassification
}

internal object ExternalIntentClassifier {
    fun classify(input: ExternalIntentInput): ExternalIntentClassification {
        if (input.action != EXTERNAL_VIEW_ACTION) {
            return ExternalIntentClassification.NotExternalView
        }
        if (input.hasSelector || input.hasClipData || input.packageOverride != null) {
            return ExternalIntentClassification.Rejected(
                ExternalIntentRejection.NESTED_OR_OVERRIDDEN,
            )
        }
        val data = input.data?.takeIf(String::isNotBlank)
            ?: return ExternalIntentClassification.Rejected(ExternalIntentRejection.MISSING_DATA)
        if (!hasBoundedUtf8Length(data, MAX_EXTERNAL_SOURCE_BYTES)) {
            return ExternalIntentClassification.Rejected(
                ExternalIntentRejection.SOURCE_TOO_LARGE,
            )
        }
        return when {
            input.scheme.equals("magnet", ignoreCase = true) ->
                ExternalIntentClassification.Magnet(
                    ExternalIntakeSource.create(ExternalIntakeKind.MAGNET, data),
                )
            input.scheme.equals("content", ignoreCase = true) -> {
                if (!input.hasReadGrant) {
                    ExternalIntentClassification.Rejected(
                        ExternalIntentRejection.MISSING_READ_GRANT,
                    )
                } else {
                    ExternalIntentClassification.Content(
                        ExternalIntakeSource.create(ExternalIntakeKind.TORRENT_FILE, data),
                        input.mimeType?.lowercase(),
                        input.path?.endsWith(".torrent", ignoreCase = true) == true,
                    )
                }
            }
            else ->
                ExternalIntentClassification.Rejected(
                    ExternalIntentRejection.UNSUPPORTED_SCHEME,
                )
        }
    }
}

internal class ExternalIntakeSource private constructor(
    val kind: ExternalIntakeKind,
    private val value: String,
) {
    fun reveal(): String = value

    fun sameSource(other: ExternalIntakeSource): Boolean = kind == other.kind && value == other.value

    override fun equals(other: Any?): Boolean =
        other is ExternalIntakeSource && sameSource(other)

    override fun hashCode(): Int = 31 * kind.hashCode() + value.hashCode()

    override fun toString(): String = "ExternalIntakeSource(kind=$kind, value=<redacted>)"

    companion object {
        fun create(
            kind: ExternalIntakeKind,
            value: String,
        ): ExternalIntakeSource {
            require(value.isNotBlank()) { "external intake source is empty" }
            require(hasBoundedUtf8Length(value, MAX_EXTERNAL_SOURCE_BYTES)) {
                "external intake source exceeds its limit"
            }
            return ExternalIntakeSource(kind, value)
        }
    }
}

data class ExternalIntakePresentation(
    val intakeId: Long,
    val kind: ExternalIntakeKind,
    val phase: ExternalIntakePhase,
    val displayLabel: String?,
    val startContent: Boolean,
)

internal data class ExternalIntakeSnapshot(
    val presentation: ExternalIntakePresentation?,
    val descriptorCount: Int,
)

internal data class ExternalIntakeWork(
    val intakeId: Long,
    val source: ExternalIntakeSource,
    val knownLength: Long?,
    val startContent: Boolean,
    val awaitFileSelection: Boolean? = null,
) {
    override fun toString(): String =
        "ExternalIntakeWork(intakeId=$intakeId, source=$source, " +
            "knownLength=$knownLength, startContent=$startContent)"
}

internal enum class ExternalAdmissionDisposition {
    ADMITTED,
    COALESCED,
    QUEUE_FULL,
}

internal enum class ExternalSubmissionFailureDisposition {
    RETRYABLE,
    TERMINAL,
}

internal data class ExternalAdmissionResult(
    val disposition: ExternalAdmissionDisposition,
    val intakeId: Long?,
)

internal class ExternalIntakeController(
    private val maximumDescriptors: Int = MAX_EXTERNAL_INTAKE_DESCRIPTORS,
) {
    private data class Record(
        val intakeId: Long,
        val source: ExternalIntakeSource,
        var phase: ExternalIntakePhase,
        var displayLabel: String? = null,
        var knownLength: Long? = null,
        var startContent: Boolean = true,
        var awaitFileSelection: Boolean? = null,
        var retryUsed: Boolean = false,
    ) {
        override fun toString(): String =
            "Record(intakeId=$intakeId, source=$source, phase=$phase, " +
                "displayLabel=$displayLabel, knownLength=$knownLength, " +
                "startContent=$startContent, retryUsed=$retryUsed)"
    }

    private val records = mutableListOf<Record>()
    private var nextIntakeId = 1L

    init {
        require(maximumDescriptors > 0)
    }

    fun receive(
        source: ExternalIntakeSource,
        needsMetadataValidation: Boolean,
        rootReady: Boolean,
    ): ExternalAdmissionResult {
        val duplicate = records.firstOrNull { it.source.sameSource(source) }
        if (duplicate != null) {
            return ExternalAdmissionResult(
                ExternalAdmissionDisposition.COALESCED,
                duplicate.intakeId,
            )
        }
        if (records.size >= maximumDescriptors) {
            return ExternalAdmissionResult(ExternalAdmissionDisposition.QUEUE_FULL, null)
        }
        val intakeId = nextIntakeId++
        records +=
            Record(
                intakeId = intakeId,
                source = source,
                phase =
                    if (needsMetadataValidation) {
                        ExternalIntakePhase.RECEIVED
                    } else {
                        ExternalIntakePhase.QUEUED
                    },
            )
        promote(rootReady)
        return ExternalAdmissionResult(ExternalAdmissionDisposition.ADMITTED, intakeId)
    }

    fun nextReceived(): ExternalIntakeWork? =
        records
            .firstOrNull { it.phase == ExternalIntakePhase.RECEIVED }
            ?.toWork()

    fun completeContentAdmission(
        intakeId: Long,
        accepted: Boolean,
        displayLabel: String?,
        knownLength: Long?,
        rootReady: Boolean,
    ): Boolean {
        val index = records.indexOfFirst { it.intakeId == intakeId }
        if (index < 0 || records[index].phase != ExternalIntakePhase.RECEIVED) return false
        if (!accepted) {
            records.removeAt(index)
            promote(rootReady)
            return true
        }
        records[index].apply {
            phase = ExternalIntakePhase.QUEUED
            this.displayLabel = boundedExternalDisplayLabel(displayLabel)
            this.knownLength = knownLength?.takeIf { it >= 0L }
        }
        promote(rootReady)
        return true
    }

    fun setStartContent(
        intakeId: Long,
        startContent: Boolean,
    ): Boolean {
        val record = records.firstOrNull { it.intakeId == intakeId } ?: return false
        if (
            record.phase !in
            setOf(
                ExternalIntakePhase.PRESENTED,
                ExternalIntakePhase.AWAITING_ROOT,
                ExternalIntakePhase.RETRYABLE_FAILURE,
            )
        ) {
            return false
        }
        record.startContent = startContent
        return true
    }

    fun confirm(
        intakeId: Long,
        rootReady: Boolean,
        awaitFileSelection: Boolean? = null,
    ): ExternalIntakeWork? {
        val record = records.firstOrNull { it.intakeId == intakeId } ?: return null
        if (
            record.phase != ExternalIntakePhase.PRESENTED &&
            record.phase != ExternalIntakePhase.AWAITING_ROOT
        ) {
            return null
        }
        if (awaitFileSelection != null) record.awaitFileSelection = awaitFileSelection
        if (!rootReady) {
            record.phase = ExternalIntakePhase.AWAITING_ROOT
            return null
        }
        record.phase = ExternalIntakePhase.SUBMITTING
        return record.toWork()
    }

    fun retry(
        intakeId: Long,
        rootReady: Boolean,
    ): ExternalIntakeWork? {
        val record = records.firstOrNull { it.intakeId == intakeId } ?: return null
        if (record.phase != ExternalIntakePhase.RETRYABLE_FAILURE || !rootReady) return null
        record.retryUsed = true
        record.phase = ExternalIntakePhase.SUBMITTING
        return record.toWork()
    }

    fun submissionRootUnavailable(intakeId: Long): Boolean {
        val record = records.firstOrNull { it.intakeId == intakeId } ?: return false
        if (record.phase != ExternalIntakePhase.SUBMITTING) return false
        record.phase = ExternalIntakePhase.AWAITING_ROOT
        return true
    }

    fun failSubmission(
        intakeId: Long,
        retryable: Boolean,
        rootReady: Boolean,
    ): ExternalSubmissionFailureDisposition? {
        val index = records.indexOfFirst { it.intakeId == intakeId }
        if (index < 0 || records[index].phase != ExternalIntakePhase.SUBMITTING) return null
        val record = records[index]
        if (retryable && !record.retryUsed) {
            record.phase = ExternalIntakePhase.RETRYABLE_FAILURE
            return ExternalSubmissionFailureDisposition.RETRYABLE
        } else {
            records.removeAt(index)
            promote(rootReady)
            return ExternalSubmissionFailureDisposition.TERMINAL
        }
    }

    fun completeSubmission(
        intakeId: Long,
        rootReady: Boolean,
    ): Boolean = removeTerminal(intakeId, rootReady)

    fun cancel(
        intakeId: Long,
        rootReady: Boolean,
    ): Boolean = removeTerminal(intakeId, rootReady)

    fun rootAvailabilityChanged(rootReady: Boolean) {
        val current = records.firstOrNull() ?: return
        current.phase =
            when {
                rootReady && current.phase == ExternalIntakePhase.AWAITING_ROOT ->
                    ExternalIntakePhase.PRESENTED
                !rootReady && current.phase == ExternalIntakePhase.PRESENTED ->
                    ExternalIntakePhase.AWAITING_ROOT
                else -> current.phase
            }
        promote(rootReady)
    }

    fun snapshot(): ExternalIntakeSnapshot {
        val current = records.firstOrNull()
        val presentation =
            current
                ?.takeIf {
                    it.phase in
                        setOf(
                            ExternalIntakePhase.PRESENTED,
                            ExternalIntakePhase.AWAITING_ROOT,
                            ExternalIntakePhase.SUBMITTING,
                            ExternalIntakePhase.RETRYABLE_FAILURE,
                        )
                }
                ?.let {
                    ExternalIntakePresentation(
                        intakeId = it.intakeId,
                        kind = it.source.kind,
                        phase = it.phase,
                        displayLabel = it.displayLabel,
                        startContent = it.startContent,
                    )
                }
        return ExternalIntakeSnapshot(presentation, records.size)
    }

    fun descriptorCount(): Int = records.size

    override fun toString(): String =
        "ExternalIntakeController(maximumDescriptors=$maximumDescriptors, records=$records)"

    private fun removeTerminal(
        intakeId: Long,
        rootReady: Boolean,
    ): Boolean {
        val index = records.indexOfFirst { it.intakeId == intakeId }
        if (index < 0) return false
        records.removeAt(index)
        promote(rootReady)
        return true
    }

    private fun promote(rootReady: Boolean) {
        val current = records.firstOrNull() ?: return
        if (current.phase != ExternalIntakePhase.QUEUED) return
        current.phase =
            if (rootReady) {
                ExternalIntakePhase.PRESENTED
            } else {
                ExternalIntakePhase.AWAITING_ROOT
            }
    }

    private fun Record.toWork(): ExternalIntakeWork =
        ExternalIntakeWork(intakeId, source, knownLength, startContent, awaitFileSelection)
}

internal fun boundedExternalDisplayLabel(value: String?): String? {
    val candidate = value?.trim()?.takeIf(String::isNotEmpty) ?: return null
    if (
        candidate.any { it.code < 0x20 || it.code == 0x7f } ||
        candidate.contains('/') ||
        candidate.contains('\\') ||
        candidate.contains("://") ||
        candidate.any { it in "?#&=" }
    ) {
        return null
    }
    return truncateUtf8(candidate, MAX_EXTERNAL_DISPLAY_LABEL_BYTES)
}

internal fun hasTorrentSuffix(value: String?): Boolean =
    value?.endsWith(".torrent", ignoreCase = true) == true

private fun hasBoundedUtf8Length(
    value: String,
    maximumBytes: Int,
): Boolean =
    value.length <= maximumBytes &&
        value.toByteArray(StandardCharsets.UTF_8).size <= maximumBytes

private fun truncateUtf8(
    value: String,
    maximumBytes: Int,
): String {
    if (value.toByteArray(StandardCharsets.UTF_8).size <= maximumBytes) return value
    val result = StringBuilder()
    var bytes = 0
    var index = 0
    while (index < value.length) {
        val codePoint = Character.codePointAt(value, index)
        val encoded = String(Character.toChars(codePoint))
        val count = encoded.toByteArray(StandardCharsets.UTF_8).size
        if (bytes + count > maximumBytes) break
        result.append(encoded)
        bytes += count
        index += Character.charCount(codePoint)
    }
    return result.toString()
}
