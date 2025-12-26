package com.jstorrent.app.viewmodel

import com.jstorrent.app.model.TorrentFilter
import com.jstorrent.app.model.TorrentListUiState
import com.jstorrent.app.model.TorrentSortOrder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TorrentListViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var repository: FakeTorrentRepository
    private lateinit var viewModel: TorrentListViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = FakeTorrentRepository()
        viewModel = TorrentListViewModel(repository)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // =========================================================================
    // Initial state tests
    // =========================================================================

    @Test
    fun `initial state is Loading`() = runTest {
        advanceUntilIdle()
        val state = viewModel.uiState.value
        assertEquals(TorrentListUiState.Loading, state)
    }

    @Test
    fun `state transitions to Loaded when engine loads`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(emptyList())
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TorrentListUiState.Loaded)
    }

    @Test
    fun `state shows Error when engine fails to load`() = runTest {
        repository.setError("Failed to load engine")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TorrentListUiState.Error)
        assertEquals("Failed to load engine", (state as TorrentListUiState.Error).message)
    }

    // =========================================================================
    // Torrent list tests
    // =========================================================================

    @Test
    fun `torrents emitted when engine loaded`() = runTest {
        val torrents = listOf(
            createTestTorrent("hash1", "Torrent 1"),
            createTestTorrent("hash2", "Torrent 2")
        )
        repository.setLoaded(true)
        repository.setTorrents(torrents)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(2, state.torrents.size)
        assertEquals("hash1", state.torrents[0].infoHash)
        assertEquals("hash2", state.torrents[1].infoHash)
    }

    // =========================================================================
    // Pause/Resume tests
    // =========================================================================

    @Test
    fun `pauseTorrent calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("hash1")))
        advanceUntilIdle()

        viewModel.pauseTorrent("hash1")

        assertEquals(listOf("hash1"), repository.pausedTorrents)
    }

    @Test
    fun `resumeTorrent calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("hash1", status = "stopped")))
        advanceUntilIdle()

        viewModel.resumeTorrent("hash1")

        assertEquals(listOf("hash1"), repository.resumedTorrents)
    }

    @Test
    fun `pauseTorrent updates state`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("hash1", status = "downloading")))
        advanceUntilIdle()

        viewModel.pauseTorrent("hash1")
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals("stopped", state.torrents[0].status)
    }

    @Test
    fun `pauseAll calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1"),
            createTestTorrent("hash2")
        ))
        advanceUntilIdle()

        viewModel.pauseAll()

        assertTrue(repository.pauseAllCalled)
    }

    @Test
    fun `resumeAll calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", status = "stopped"),
            createTestTorrent("hash2", status = "stopped")
        ))
        advanceUntilIdle()

        viewModel.resumeAll()

        assertTrue(repository.resumeAllCalled)
    }

    // =========================================================================
    // Remove torrent tests
    // =========================================================================

    @Test
    fun `removeTorrent calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("hash1")))
        advanceUntilIdle()

        viewModel.removeTorrent("hash1", deleteFiles = false)

        assertEquals(listOf(Pair("hash1", false)), repository.removedTorrents)
    }

    @Test
    fun `removeTorrent with deleteFiles calls repository correctly`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("hash1")))
        advanceUntilIdle()

        viewModel.removeTorrent("hash1", deleteFiles = true)

        assertEquals(listOf(Pair("hash1", true)), repository.removedTorrents)
    }

    @Test
    fun `removeTorrent removes from list`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1"),
            createTestTorrent("hash2")
        ))
        advanceUntilIdle()

        viewModel.removeTorrent("hash1")
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(1, state.torrents.size)
        assertEquals("hash2", state.torrents[0].infoHash)
    }

    // =========================================================================
    // Filter tests
    // =========================================================================

    @Test
    fun `filterAll shows all torrents`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", status = "downloading"),
            createTestTorrent("hash2", status = "stopped"),
            createTestTorrent("hash3", status = "seeding", progress = 1.0)
        ))
        advanceUntilIdle()

        viewModel.setFilter(TorrentFilter.ALL)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(3, state.torrents.size)
    }

    @Test
    fun `filterQueued shows only active torrents`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", status = "downloading"),
            createTestTorrent("hash2", status = "stopped"),
            createTestTorrent("hash3", status = "seeding", progress = 1.0),
            createTestTorrent("hash4", status = "checking")
        ))
        advanceUntilIdle()

        viewModel.setFilter(TorrentFilter.QUEUED)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(2, state.torrents.size)
        assertEquals("hash1", state.torrents[0].infoHash)
        assertEquals("hash4", state.torrents[1].infoHash)
    }

    @Test
    fun `filterFinished shows only completed torrents`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", status = "downloading", progress = 0.5),
            createTestTorrent("hash2", status = "stopped", progress = 1.0),
            createTestTorrent("hash3", status = "seeding", progress = 1.0)
        ))
        advanceUntilIdle()

        viewModel.setFilter(TorrentFilter.FINISHED)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(2, state.torrents.size)
        assertTrue(state.torrents.all { it.progress >= 0.999 })
    }

    // =========================================================================
    // Sort tests
    // =========================================================================

    @Test
    fun `sortByName sorts alphabetically`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", name = "Zebra"),
            createTestTorrent("hash2", name = "Apple"),
            createTestTorrent("hash3", name = "Mango")
        ))
        advanceUntilIdle()

        viewModel.setSortOrder(TorrentSortOrder.NAME)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals("Apple", state.torrents[0].name)
        assertEquals("Mango", state.torrents[1].name)
        assertEquals("Zebra", state.torrents[2].name)
    }

    @Test
    fun `sortByDownloadSpeed sorts fastest first`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", downloadSpeed = 1000),
            createTestTorrent("hash2", downloadSpeed = 5000),
            createTestTorrent("hash3", downloadSpeed = 2000)
        ))
        advanceUntilIdle()

        viewModel.setSortOrder(TorrentSortOrder.DOWNLOAD_SPEED)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(5000L, state.torrents[0].downloadSpeed)
        assertEquals(2000L, state.torrents[1].downloadSpeed)
        assertEquals(1000L, state.torrents[2].downloadSpeed)
    }

    @Test
    fun `sortByQueueOrder preserves original order`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", name = "First"),
            createTestTorrent("hash2", name = "Second"),
            createTestTorrent("hash3", name = "Third")
        ))
        advanceUntilIdle()

        viewModel.setSortOrder(TorrentSortOrder.QUEUE_ORDER)
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals("First", state.torrents[0].name)
        assertEquals("Second", state.torrents[1].name)
        assertEquals("Third", state.torrents[2].name)
    }

    // =========================================================================
    // Add torrent tests
    // =========================================================================

    @Test
    fun `addTorrent calls repository`() = runTest {
        repository.setLoaded(true)
        advanceUntilIdle()

        viewModel.addTorrent("magnet:?xt=urn:btih:abc123")

        assertEquals(listOf("magnet:?xt=urn:btih:abc123"), repository.addedTorrents)
    }

    @Test
    fun `addTorrent with blank input does nothing`() = runTest {
        repository.setLoaded(true)
        advanceUntilIdle()

        viewModel.addTorrent("")
        viewModel.addTorrent("   ")

        assertTrue(repository.addedTorrents.isEmpty())
    }

    // =========================================================================
    // Helper method tests
    // =========================================================================

    @Test
    fun `isPaused returns true for stopped torrents`() {
        val paused = createTestTorrent(status = "stopped")
        val downloading = createTestTorrent(status = "downloading")

        assertTrue(viewModel.isPaused(paused))
        assertFalse(viewModel.isPaused(downloading))
    }

    @Test
    fun `getFilterCount returns correct counts`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent("hash1", status = "downloading"),
            createTestTorrent("hash2", status = "downloading"),
            createTestTorrent("hash3", status = "seeding", progress = 1.0),
            createTestTorrent("hash4", status = "stopped", progress = 1.0)
        ))
        advanceUntilIdle()

        assertEquals(4, viewModel.getFilterCount(TorrentFilter.ALL))
        assertEquals(2, viewModel.getFilterCount(TorrentFilter.QUEUED))
        assertEquals(2, viewModel.getFilterCount(TorrentFilter.FINISHED))
    }
}
