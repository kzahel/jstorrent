package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalTorrentIntakeTest {
    @Test
    fun classifierAcceptsOnlyBoundedViewSources() {
        val magnet = "magnet:?xt=urn:btih:${"a".repeat(40)}"
        assertTrue(classify(data = magnet, scheme = "MAGNET") is ExternalIntentClassification.Magnet)
        assertTrue(
            classify(
                data = "content://fixture/item/one.torrent",
                scheme = "content",
                mimeType = BITTORRENT_MIME_TYPE,
                path = "/item/one.torrent",
                readGrant = true,
            ) is ExternalIntentClassification.Content,
        )
        assertEquals(
            ExternalIntentClassification.NotExternalView,
            classify(action = "android.intent.action.SEND", data = magnet, scheme = "magnet"),
        )
        listOf("file", "http", "https", "rstorrent").forEach { scheme ->
            assertEquals(
                ExternalIntentClassification.Rejected(ExternalIntentRejection.UNSUPPORTED_SCHEME),
                classify(data = "$scheme://fixture/item.torrent", scheme = scheme),
            )
        }
        assertEquals(
            ExternalIntentClassification.Rejected(ExternalIntentRejection.MISSING_READ_GRANT),
            classify(
                data = "content://fixture/item.torrent",
                scheme = "content",
                path = "/item.torrent",
            ),
        )
    }

    @Test
    fun classifierRejectsNestedAndOverriddenIntents() {
        val source = "magnet:?xt=urn:btih:${"b".repeat(40)}"
        listOf(
            classify(data = source, scheme = "magnet", selector = true),
            classify(data = source, scheme = "magnet", clipData = true),
            classify(data = source, scheme = "magnet", packageOverride = "fixture.target"),
        ).forEach {
            assertEquals(
                ExternalIntentClassification.Rejected(
                    ExternalIntentRejection.NESTED_OR_OVERRIDDEN,
                ),
                it,
            )
        }
    }

    @Test
    fun classifierEnforcesTheExactUtf8Limit() {
        val prefix = "magnet:?"
        val exact = prefix + "x".repeat(MAX_EXTERNAL_SOURCE_BYTES - prefix.length)
        val over = "$exact!"

        assertTrue(classify(data = exact, scheme = "magnet") is ExternalIntentClassification.Magnet)
        assertEquals(
            ExternalIntentClassification.Rejected(ExternalIntentRejection.SOURCE_TOO_LARGE),
            classify(data = over, scheme = "magnet"),
        )
        val multiByte = prefix + "é".repeat((MAX_EXTERNAL_SOURCE_BYTES - prefix.length) / 2 + 1)
        assertEquals(
            ExternalIntentClassification.Rejected(ExternalIntentRejection.SOURCE_TOO_LARGE),
            classify(data = multiByte, scheme = "magnet"),
        )
    }

    @Test
    fun queueCoalescesSourcesAndRejectsOnlyTheNinthDescriptor() {
        val controller = ExternalIntakeController()
        val first = source(0)
        assertEquals(
            ExternalAdmissionDisposition.ADMITTED,
            controller.receive(first, needsMetadataValidation = false, rootReady = true).disposition,
        )
        assertEquals(ExternalIntakePhase.PRESENTED, controller.snapshot().presentation?.phase)
        assertEquals(
            ExternalAdmissionDisposition.COALESCED,
            controller.receive(first, needsMetadataValidation = false, rootReady = true).disposition,
        )
        repeat(7) { index ->
            assertEquals(
                ExternalAdmissionDisposition.ADMITTED,
                controller.receive(
                    source(index + 1),
                    needsMetadataValidation = false,
                    rootReady = true,
                ).disposition,
            )
        }
        assertEquals(8, controller.descriptorCount())
        assertEquals(
            ExternalAdmissionDisposition.QUEUE_FULL,
            controller.receive(source(9), false, true).disposition,
        )
        assertEquals(8, controller.descriptorCount())
    }

    @Test
    fun queuePreservesAdmissionOrderAcrossMetadataValidation() {
        val controller = ExternalIntakeController()
        val content =
            ExternalIntakeSource.create(
                ExternalIntakeKind.TORRENT_FILE,
                "content://fixture/private/first",
            )
        val first = controller.receive(content, needsMetadataValidation = true, rootReady = true)
        val second = controller.receive(source(2), needsMetadataValidation = false, rootReady = true)
        assertNull(controller.snapshot().presentation)
        assertEquals(first.intakeId, controller.nextReceived()?.intakeId)

        controller.completeContentAdmission(
            requireNotNull(first.intakeId),
            accepted = true,
            displayLabel = "first.torrent",
            knownLength = 123,
            rootReady = true,
        )
        assertEquals(first.intakeId, controller.snapshot().presentation?.intakeId)
        controller.cancel(requireNotNull(first.intakeId), rootReady = true)
        assertEquals(second.intakeId, controller.snapshot().presentation?.intakeId)
    }

    @Test
    fun rootSubmissionRetryAndTerminalAdvanceAreDeterministic() {
        val controller = ExternalIntakeController()
        val first = controller.receive(source(1), false, rootReady = false)
        val second = controller.receive(source(2), false, rootReady = false)
        val firstId = requireNotNull(first.intakeId)
        assertEquals(ExternalIntakePhase.AWAITING_ROOT, controller.snapshot().presentation?.phase)
        assertNull(controller.confirm(firstId, rootReady = false))
        controller.rootAvailabilityChanged(true)
        assertEquals(ExternalIntakePhase.PRESENTED, controller.snapshot().presentation?.phase)
        assertEquals(firstId, controller.confirm(firstId, rootReady = true)?.intakeId)
        assertEquals(ExternalIntakePhase.SUBMITTING, controller.snapshot().presentation?.phase)

        assertEquals(
            ExternalSubmissionFailureDisposition.RETRYABLE,
            controller.failSubmission(firstId, retryable = true, rootReady = true),
        )
        assertEquals(
            ExternalIntakePhase.RETRYABLE_FAILURE,
            controller.snapshot().presentation?.phase,
        )
        assertEquals(firstId, controller.retry(firstId, rootReady = true)?.intakeId)
        assertEquals(
            ExternalSubmissionFailureDisposition.TERMINAL,
            controller.failSubmission(firstId, retryable = true, rootReady = true),
        )
        assertEquals(second.intakeId, controller.snapshot().presentation?.intakeId)
        assertEquals(1, controller.descriptorCount())
    }

    @Test
    fun terminalSourceCanBeAdmittedAgainWithAMonotonicId() {
        val controller = ExternalIntakeController()
        val source = source(4)
        val first = requireNotNull(controller.receive(source, false, true).intakeId)
        assertTrue(controller.completeSubmission(first, rootReady = true))
        val second = requireNotNull(controller.receive(source, false, true).intakeId)
        assertTrue(second > first)
    }

    @Test
    fun rootLossDuringSubmissionReturnsToRootWait() {
        val controller = ExternalIntakeController()
        val intakeId = requireNotNull(controller.receive(source(5), false, true).intakeId)
        assertEquals(intakeId, controller.confirm(intakeId, true)?.intakeId)
        assertTrue(controller.submissionRootUnavailable(intakeId))
        assertEquals(ExternalIntakePhase.AWAITING_ROOT, controller.snapshot().presentation?.phase)
        controller.rootAvailabilityChanged(true)
        assertEquals(ExternalIntakePhase.PRESENTED, controller.snapshot().presentation?.phase)
    }

    @Test
    fun sourceAndControllerStringFormsAreRedacted() {
        val sentinel = "magnet:?xt=urn:btih:${"c".repeat(40)}&tr=https://secret.invalid/token"
        val source = ExternalIntakeSource.create(ExternalIntakeKind.MAGNET, sentinel)
        val controller = ExternalIntakeController().apply { receive(source, false, true) }

        assertFalse(source.toString().contains(sentinel))
        assertFalse(controller.toString().contains(sentinel))
        assertFalse(requireNotNull(controller.confirm(1, true)).toString().contains(sentinel))
    }

    @Test
    fun displayLabelsAreBoundedAndNeverBecomePathsOrUris() {
        assertEquals("safe.torrent", boundedExternalDisplayLabel(" safe.torrent "))
        assertNull(boundedExternalDisplayLabel("content://secret.invalid/private.torrent"))
        assertNull(boundedExternalDisplayLabel("folder/private.torrent"))
        val bounded = requireNotNull(boundedExternalDisplayLabel("é".repeat(200)))
        assertTrue(bounded.toByteArray(Charsets.UTF_8).size <= MAX_EXTERNAL_DISPLAY_LABEL_BYTES)
    }

    @Test
    fun perAddSelectionChoiceSurvivesRootRepairAndRetry() {
        listOf(false, true).forEach { chooseFiles ->
            val controller = ExternalIntakeController()
            val id = requireNotNull(controller.receive(source(1), false, rootReady = false).intakeId)
            assertNull(controller.confirm(id, rootReady = false, awaitFileSelection = chooseFiles))
            controller.rootAvailabilityChanged(true)
            val work = requireNotNull(controller.confirm(id, rootReady = true))
            assertEquals(chooseFiles, work.awaitFileSelection)
            controller.failSubmission(id, retryable = true, rootReady = true)
            assertEquals(chooseFiles, controller.retry(id, rootReady = true)?.awaitFileSelection)
        }
    }

    @Test
    fun heldInAppAddSubmitsWithItsChoiceOnceTheRootIsReady() {
        val controller = ExternalIntakeController()
        val held =
            requireNotNull(
                controller.receive(
                    source(1),
                    false,
                    rootReady = false,
                    heldInApp = true,
                    awaitFileSelection = true,
                ).intakeId,
            )
        val external = requireNotNull(controller.receive(source(2), false, rootReady = false).intakeId)
        assertEquals(ExternalIntakePhase.AWAITING_ROOT, controller.snapshot().presentation?.phase)
        assertNull(controller.takeHeldSubmission(rootReady = false))

        controller.rootAvailabilityChanged(true)
        val work = requireNotNull(controller.takeHeldSubmission(rootReady = true))
        assertEquals(held, work.intakeId)
        assertEquals(true, work.awaitFileSelection)
        assertTrue(work.heldInApp)
        // The submission is not presented as a confirmation.
        assertNull(controller.snapshot().presentation)

        assertTrue(controller.completeSubmission(held, rootReady = true))
        assertEquals(external, controller.snapshot().presentation?.intakeId)
        assertEquals(ExternalIntakePhase.PRESENTED, controller.snapshot().presentation?.phase)
        assertNull(controller.takeHeldSubmission(rootReady = true))
    }

    private fun source(index: Int): ExternalIntakeSource =
        ExternalIntakeSource.create(
            ExternalIntakeKind.MAGNET,
            "magnet:?xt=urn:btih:${index.toString(16).padStart(40, '0')}",
        )

    private fun classify(
        action: String? = EXTERNAL_VIEW_ACTION,
        data: String?,
        scheme: String?,
        mimeType: String? = null,
        path: String? = null,
        selector: Boolean = false,
        clipData: Boolean = false,
        packageOverride: String? = null,
        readGrant: Boolean = false,
    ): ExternalIntentClassification =
        ExternalIntentClassifier.classify(
            ExternalIntentInput(
                action,
                data,
                scheme,
                mimeType,
                path,
                selector,
                clipData,
                packageOverride,
                readGrant,
            ),
        )
}
