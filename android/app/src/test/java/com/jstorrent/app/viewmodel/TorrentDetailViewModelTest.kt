package com.jstorrent.app.viewmodel

import com.jstorrent.app.model.DetailTab
import com.jstorrent.app.model.TorrentDetailUiState
import com.jstorrent.quickjs.model.FileInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
class TorrentDetailViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var repository: FakeTorrentRepository
    private lateinit var viewModel: TorrentDetailViewModel

    private val testInfoHash = "abc123"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = FakeTorrentRepository()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(
        infoHash: String = testInfoHash,
        onEnsureEngineStarted: () -> Unit = {}
    ): TorrentDetailViewModel {
        return TorrentDetailViewModel(repository, infoHash, onEnsureEngineStarted)
    }

    // =========================================================================
    // Initial state tests
    // =========================================================================

    @Test
    fun `initial state is Loading`() = runTest {
        viewModel = createViewModel()
        advanceUntilIdle()

        assertEquals(TorrentDetailUiState.Loading, viewModel.uiState.value)
    }

    @Test
    fun `loadsTorrentById shows torrent when found`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, name = "My Torrent")))
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TorrentDetailUiState.Loaded)
        assertEquals("My Torrent", (state as TorrentDetailUiState.Loaded).torrent.name)
        assertEquals(testInfoHash, state.torrent.infoHash)
    }

    @Test
    fun `loadsTorrentById shows error when not found`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent("other-hash")))
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TorrentDetailUiState.Error)
        assertEquals("Torrent not found", (state as TorrentDetailUiState.Error).message)
    }

    // =========================================================================
    // File list tests
    // =========================================================================

    @Test
    fun `fileListUpdates shows files`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        repository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "movie.mp4", 1000000, 500000, 0.5),
                FileInfo(1, "subtitle.srt", 5000, 5000, 1.0)
            )
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertEquals(2, state.torrent.files.size)
        assertEquals("movie.mp4", state.torrent.files[0].name)
        assertEquals("subtitle.srt", state.torrent.files[1].name)
    }

    @Test
    fun `toggleFileSelection updates selection`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        repository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "file1.txt", 1000, 1000, 1.0),
                FileInfo(1, "file2.txt", 1000, 500, 0.5)
            )
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        // Initially all files are selected
        var state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertTrue(state.torrent.files.all { it.isSelected })

        // Toggle file 0
        viewModel.toggleFileSelection(0)
        advanceUntilIdle()

        state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertFalse(state.torrent.files[0].isSelected)
        assertTrue(state.torrent.files[1].isSelected)

        // Toggle file 0 again
        viewModel.toggleFileSelection(0)
        advanceUntilIdle()

        state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertTrue(state.torrent.files[0].isSelected)
    }

    // =========================================================================
    // Tab selection tests
    // =========================================================================

    @Test
    fun `setSelectedTab changes tab`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()
        advanceUntilIdle()

        assertEquals(DetailTab.STATUS, viewModel.selectedTab.value)

        viewModel.setSelectedTab(DetailTab.FILES)
        advanceUntilIdle()

        assertEquals(DetailTab.FILES, viewModel.selectedTab.value)

        val state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertEquals(DetailTab.FILES, state.selectedTab)
    }

    // =========================================================================
    // Pause/Resume tests
    // =========================================================================

    @Test
    fun `pause calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.pause()

        assertEquals(listOf(testInfoHash), repository.pausedTorrents)
    }

    @Test
    fun `resume calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, status = "stopped")))
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.resume()

        assertEquals(listOf(testInfoHash), repository.resumedTorrents)
    }

    @Test
    fun `isPaused returns correct value`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, status = "downloading")))
        viewModel = createViewModel()
        advanceUntilIdle()

        assertFalse(viewModel.isPaused())

        viewModel.pause()
        advanceUntilIdle()

        assertTrue(viewModel.isPaused())
    }

    // =========================================================================
    // Remove tests
    // =========================================================================

    @Test
    fun `remove calls repository`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.remove(deleteFiles = false)

        assertEquals(listOf(Pair(testInfoHash, false)), repository.removedTorrents)
    }

    @Test
    fun `remove with deleteFiles calls repository correctly`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.remove(deleteFiles = true)

        assertEquals(listOf(Pair(testInfoHash, true)), repository.removedTorrents)
    }

    // =========================================================================
    // ETA calculation tests
    // =========================================================================

    @Test
    fun `eta is calculated from speed and remaining`() = runTest {
        repository.setLoaded(true)
        // 1 MB/s download speed
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, downloadSpeed = 1000000)))
        // 2MB total, 1MB downloaded = 1MB remaining = 1 second ETA
        repository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "file.dat", 2000000, 1000000, 0.5)
            )
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertEquals(1L, state.torrent.eta)
    }

    @Test
    fun `eta is zero when complete`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, progress = 1.0)))
        repository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "file.dat", 1000000, 1000000, 1.0)
            )
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertEquals(0L, state.torrent.eta)
    }

    @Test
    fun `eta is null when speed is zero`() = runTest {
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash, downloadSpeed = 0)))
        repository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "file.dat", 1000000, 500000, 0.5)
            )
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value as TorrentDetailUiState.Loaded
        assertEquals(null, state.torrent.eta)
    }

    // =========================================================================
    // Stage 2: Lazy engine startup callback tests
    // =========================================================================

    @Test
    fun `opening detail view calls onEnsureEngineStarted`() = runTest {
        var callCount = 0

        // Creating the ViewModel should trigger the callback (detail view opened)
        viewModel = createViewModel(
            onEnsureEngineStarted = { callCount++ }
        )
        advanceUntilIdle()

        assertEquals(1, callCount)
    }

    @Test
    fun `onEnsureEngineStarted called only once per ViewModel creation`() = runTest {
        var callCount = 0

        // Create ViewModel
        viewModel = createViewModel(
            onEnsureEngineStarted = { callCount++ }
        )
        advanceUntilIdle()

        // Perform various operations - callback should NOT be called again
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        advanceUntilIdle()

        viewModel.setSelectedTab(DetailTab.FILES)
        viewModel.pause()
        viewModel.resume()
        advanceUntilIdle()

        // Still only 1 call from init
        assertEquals(1, callCount)
    }
}
