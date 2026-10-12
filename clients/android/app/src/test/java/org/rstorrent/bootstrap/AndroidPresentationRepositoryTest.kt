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
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.uniffi.AndroidApplicationClient
import org.rstorrent.bootstrap.uniffi.AndroidClientException
import org.rstorrent.bootstrap.uniffi.AndroidViewSubscription
import org.rstorrent.bootstrap.uniffi.NoHandle
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.SubscriptionSpec
import org.rstorrent.session.uniffi.ViewUpdate

class AndroidPresentationRepositoryTest {
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
        val repository = AndroidPresentationRepository(
            scope, MutableStateFlow(ProductState()), stopped,
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

        override suspend fun nextUpdate(): ViewUpdate? = awaitCancellation()

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
