package org.rstorrent.bootstrap

import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.uniffi.AndroidApplicationClient
import org.rstorrent.bootstrap.uniffi.AndroidClientException
import org.rstorrent.bootstrap.uniffi.AndroidViewSubscription
import org.rstorrent.bootstrap.uniffi.NoHandle
import org.rstorrent.session.uniffi.CatalogPageRequest
import org.rstorrent.session.uniffi.CatalogPageView
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.LibraryArchivedFilter
import org.rstorrent.session.uniffi.LibraryAvailabilityFilter
import org.rstorrent.session.uniffi.LibraryFacetsView
import org.rstorrent.session.uniffi.LibraryGrouping
import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.LibraryMediaQuery
import org.rstorrent.session.uniffi.LibraryMediaSort
import org.rstorrent.session.uniffi.SubscriptionSpec
import org.rstorrent.session.uniffi.ViewProjection
import org.rstorrent.session.uniffi.ViewSelector
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload

class AndroidPresentationRepositoryTest {
    @Test
    fun restoredSelectionSurvivesAnOlderClearResumingAfterStartup() = withFixture { fixture ->
        val queued = ArrayDeque<(AndroidPresentationRepository) -> Unit>()
        val presentation = PendingSelectionPresentation { queued.add(it) }
        presentation.clear()
        presentation.present("restored", 0U)
        queued.removeLast()(fixture.repository)
        queued.removeFirst()(fixture.repository)
        assertEquals(4, fixture.client.calls)
        assertFalse(fixture.client.subscriptions.last().closed)
        assertTrue(fixture.errors.isEmpty())
    }

    @Test
    fun dismissedSelectionCannotBeReopenedByAnOlderStartupRequest() = withFixture { fixture ->
        val queued = ArrayDeque<(AndroidPresentationRepository) -> Unit>()
        val presentation = PendingSelectionPresentation { queued.add(it) }
        presentation.present("dismissed", 0U)
        presentation.clear()
        queued.removeLast()(fixture.repository)
        queued.removeFirst()(fixture.repository)
        assertEquals(3, fixture.client.calls)
        assertTrue(fixture.errors.isEmpty())
    }

    @Test
    fun generatedDestroyedClientGuardMatchesProductionException() = withFixture { fixture ->
        val client = AndroidApplicationClient(NoHandle)
        client.close()
        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking { client.subscribe(fixture.client.specs.first()) }
        }
        assertEquals("AndroidApplicationClient object has already been destroyed", error.message)
    }

    @Test
    fun requestsAfterCloseCannotReachDestroyedGeneratedClient() = withFixture { fixture ->
        fixture.closeRepository()
        fixture.client.close()
        fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
        assertEquals(3, fixture.client.calls)
        assertTrue(fixture.uncaught.isEmpty())
        assertTrue(fixture.errors.isEmpty())
    }

    @Test
    fun everyPresentationRouteIsTerminalAfterClose() = withFixture { fixture ->
        fixture.closeRepository()
        fixture.repository.selectTorrent("torrent")
        fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
        fixture.repository.clearTorrent("torrent")
        fixture.repository.presentCatalogPage("torrent", TorrentPresentation.FILES, 0U)
        fixture.repository.presentPendingFileSelection("torrent", 0U)
        fixture.repository.clearPendingFileSelection()
        fixture.repository.presentGlobal(GlobalPresentation.SPEED)
        fixture.repository.presentLibrary(libraryRequest("show"))
        fixture.repository.configureDiagnostics(
            DiagnosticProfile.NORMAL, DiagnosticSeverity.INFO, emptyList(), true,
        )
        assertEquals(3, fixture.client.calls)
        assertTrue(fixture.client.subscriptions.all { it.closed })
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun queuedRequestIsInvalidatedByClose() {
        val dispatcher = QueuedDispatcher()
        withFixture(dispatcher) { fixture ->
            fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
            fixture.closeRepository()
            fixture.client.close()
            dispatcher.runAll()
            assertEquals(3, fixture.client.calls)
            assertTrue(fixture.uncaught.isEmpty())
        }
    }

    @Test
    fun requestQueuedAfterCloseCannotReopenTheRepository() {
        val dispatcher = QueuedDispatcher()
        withFixture(dispatcher) { fixture ->
            fixture.closeRepository()
            fixture.client.close()
            fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
            dispatcher.runAll()
            assertEquals(3, fixture.client.calls)
            assertTrue(fixture.uncaught.isEmpty())
        }
    }

    @Test
    fun serviceStopFencesRequestsBeforeRepositoryClose() = withFixture { fixture ->
        fixture.stopped.set(true)
        fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
        fixture.repository.presentGlobal(GlobalPresentation.SPEED)
        assertEquals(3, fixture.client.calls)
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun activeAcquisitionFailureIsReportedAndRetryRemainsUsable() = withFixture { fixture ->
        val failure = AndroidClientException.Failure("subscription rejected")
        fixture.client.acquire = { throw failure }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.FILES)
        assertEquals(1, fixture.errors.size)
        assertSame(failure, fixture.errors.single())
        assertTrue(fixture.uncaught.isEmpty())
        fixture.client.acquire = { FakeSubscription() }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.FILES)
        assertFalse(fixture.client.subscriptions.last().closed)
    }

    @Test
    fun partialGroupFailureReleasesAlreadyAcquiredSubscription() = withFixture { fixture ->
        val failure = AndroidClientException.Failure("second subscription rejected")
        fixture.client.acquire = {
            if (fixture.client.calls == 5) throw failure
            FakeSubscription()
        }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.PIECES)
        assertTrue(fixture.client.subscriptions.last().closed)
        assertSame(failure, fixture.errors.single())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun partialGroupCancellationReleasesItsOwnerWithoutReportingFailure() = withFixture { fixture ->
        fixture.client.acquire = {
            if (fixture.client.calls == 5) throw CancellationException("cancel second acquisition")
            FakeSubscription()
        }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.PEERS)
        assertTrue(fixture.client.subscriptions.last().closed)
        assertTrue(fixture.errors.isEmpty())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun unexpectedSetupFailureIsReportedWithoutEscapingTheChildCoroutine() = withFixture { fixture ->
        val failure = IllegalStateException("adapter failure")
        fixture.client.acquire = { throw failure }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.FILES)
        assertSame(failure, fixture.errors.single())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun ordinaryReselectionReleasesThePreviousGroup() = withFixture { fixture ->
        fixture.repository.presentTorrent("first", TorrentPresentation.PEERS)
        val previous = fixture.client.subscriptions.takeLast(2)
        fixture.repository.presentTorrent("second", TorrentPresentation.FILES)
        assertTrue(previous.all { it.closed })
        assertFalse(fixture.client.subscriptions.last().closed)
        assertEquals(6, fixture.client.calls)
        assertTrue(fixture.errors.isEmpty())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun cancellationIsNotReportedAsAnApplicationFailure() = withFixture { fixture ->
        fixture.client.acquire = { throw CancellationException("cancel acquisition") }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.FILES)
        assertTrue(fixture.errors.isEmpty())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun libraryLeaseStampsItsPagesAndClearsThemOnReplacement() = withFixture { fixture ->
        val first = libraryRequest("show")
        fixture.repository.presentLibrary(first)
        val spec = fixture.client.specs.last()
        assertEquals(ViewSelector.Library(first.query), spec.selector)
        assertEquals(ViewProjection.LIBRARY_MEDIA, spec.projection)
        assertEquals(CatalogPageRequest(0U, 100U), spec.catalogPage)
        val firstLease = fixture.client.subscriptions.last()
        firstLease.updates.trySend(libraryPage("stream-a", libraryMediaItem(0U)))
        assertEquals(first, fixture.state.value.libraryMedia?.request)
        assertEquals(1, fixture.state.value.libraryMedia?.items?.size)

        // The previous page never answers the new request.
        val second = libraryRequest("movie")
        fixture.repository.presentLibrary(second)
        assertTrue(firstLease.closed)
        assertNull(fixture.state.value.libraryMedia)
        fixture.client.subscriptions.last().updates.trySend(
            libraryPage("stream-b", libraryMediaItem(0U), libraryMediaItem(1U)),
        )
        assertEquals(second, fixture.state.value.libraryMedia?.request)
        assertEquals(2, fixture.state.value.libraryMedia?.items?.size)

        val calls = fixture.client.calls
        fixture.repository.presentLibrary(null)
        assertTrue(fixture.client.subscriptions.last().closed)
        assertNull(fixture.state.value.libraryMedia)
        assertEquals(calls, fixture.client.calls)
        assertTrue(fixture.errors.isEmpty())
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun closeReleasesTheLibraryLease() = withFixture { fixture ->
        fixture.repository.presentLibrary(libraryRequest("show"))
        val lease = fixture.client.subscriptions.last()
        fixture.closeRepository()
        assertTrue(lease.closed)
        assertTrue(fixture.uncaught.isEmpty())
    }

    @Test
    fun latestLibraryRequestWinsAcrossDelayedDispatch() = withFixture { fixture ->
        val queued = ArrayDeque<(AndroidPresentationRepository) -> Unit>()
        val presentation = LatestPresentationRequest { queued.add(it) }
        presentation.submit { it.presentLibrary(libraryRequest("first")) }
        presentation.submit { it.presentLibrary(libraryRequest("second")) }
        queued.removeLast()(fixture.repository)
        queued.removeFirst()(fixture.repository)
        assertEquals(4, fixture.client.calls)
        assertEquals(
            ViewSelector.Library(libraryRequest("second").query),
            fixture.client.specs.last().selector,
        )
        assertFalse(fixture.client.subscriptions.last().closed)
    }

    @Test
    fun closeWaitsForAcquisitionThenReleasesItsOwner() = withFixture { fixture ->
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        fixture.client.acquire = {
            started.complete(Unit)
            release.await()
            FakeSubscription()
        }
        fixture.repository.presentTorrent("torrent", TorrentPresentation.FILES)
        assertTrue(started.isCompleted)
        runBlocking {
            val closing = async(start = CoroutineStart.UNDISPATCHED) { fixture.repository.close() }
            assertFalse(closing.isCompleted)
            release.complete(Unit)
            closing.await()
        }
        assertTrue(fixture.client.subscriptions.all { it.closed })
        assertTrue(fixture.uncaught.isEmpty())
    }

    private fun libraryRequest(text: String) =
        LibraryMediaRequest(
            LibraryMediaQuery(
                text = text,
                kinds = emptyList(),
                roles = emptyList(),
                availability = LibraryAvailabilityFilter.ANY,
                archived = LibraryArchivedFilter.EXCLUDE,
                torrentId = null,
                groupId = null,
                grouping = LibraryGrouping.UNGROUPED,
                sort = LibraryMediaSort.TITLE,
                descending = false,
            ),
            0U,
            100U,
        )

    private fun libraryPage(
        stream: String,
        vararg items: LibraryMediaItemView,
    ) = ViewUpdate(
        2U.toUShort(),
        stream,
        "epoch-1",
        "1",
        "0",
        "1",
        ViewUpdatePayload.Snapshot(
            ViewSnapshot.LibraryMedia(
                CatalogPageView(0U, 100U, items.size.toUInt(), null),
                LibraryFacetsView(
                    items = items.size.toUInt(), video = items.size.toUInt(), audio = 0U,
                    episodes = items.size.toUInt(), movies = 0U, otherVideos = 0U, tracks = 0U,
                    offline = 0U, incomplete = items.size.toUInt(), series = 1U, albums = 0U,
                    torrents = 1U, metadataPending = 0U,
                ),
                items.toList(),
                emptyList(),
            ),
        ),
    )

    private fun withFixture(
        dispatcher: CoroutineDispatcher = Dispatchers.Unconfined,
        block: (Fixture) -> Unit,
    ) {
        val fixture = Fixture(dispatcher)
        try {
            block(fixture)
        } finally {
            fixture.closeRepository()
            fixture.scope.cancel()
            (dispatcher as? QueuedDispatcher)?.runAll()
            fixture.client.close()
        }
    }

    private class Fixture(private val dispatcher: CoroutineDispatcher) {
        val stopped = AtomicBoolean()
        val uncaught = mutableListOf<Throwable>()
        val errors = mutableListOf<Throwable>()
        val scope = CoroutineScope(
            SupervisorJob() + dispatcher + CoroutineExceptionHandler { _, error -> uncaught += error },
        )
        val client = FakeClient()
        val state = MutableStateFlow(ProductState())
        val repository = AndroidPresentationRepository(
            scope, state, stopped,
            onUpdate = { _, _, _ -> }, onError = { errors += it },
        )

        init {
            runBlocking { repository.start(client) }
        }

        fun closeRepository() = runBlocking {
            val closing = async(start = CoroutineStart.UNDISPATCHED) { repository.close() }
            if (dispatcher is QueuedDispatcher) {
                repeat(100) {
                    dispatcher.runAll()
                    yield()
                    if (closing.isCompleted) return@runBlocking closing.await()
                }
                error("repository closure did not settle")
            }
            closing.await()
        }
    }

    private class FakeClient : AndroidApplicationClient(NoHandle) {
        var calls = 0
        var released = false
        val subscriptions = mutableListOf<FakeSubscription>()
        val specs = mutableListOf<SubscriptionSpec>()
        var acquire: suspend () -> FakeSubscription = { FakeSubscription() }

        override suspend fun subscribe(spec: SubscriptionSpec): AndroidViewSubscription {
            if (released) return super.subscribe(spec)
            calls++
            specs += spec
            return acquire().also { subscriptions += it }
        }

        override fun close() {
            super.close()
            released = true
        }
    }

    private class FakeSubscription : AndroidViewSubscription(NoHandle) {
        var closed = false
        val updates = Channel<ViewUpdate>(Channel.UNLIMITED)

        override suspend fun nextUpdate(): ViewUpdate? = updates.receive()

        override fun close() {
            closed = true
            super.close()
        }
    }

    private class QueuedDispatcher : CoroutineDispatcher() {
        private val queue = ArrayDeque<Runnable>()

        override fun dispatch(context: CoroutineContext, block: Runnable) {
            queue.addLast(block)
        }

        fun runAll() {
            while (queue.isNotEmpty()) queue.removeFirst().run()
        }
    }
}
