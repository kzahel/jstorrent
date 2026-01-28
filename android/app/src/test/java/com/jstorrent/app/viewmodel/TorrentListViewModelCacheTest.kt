package com.jstorrent.app.viewmodel

import com.jstorrent.app.cache.FakeTorrentSummaryCache
import com.jstorrent.app.cache.createTestCachedSummary
import com.jstorrent.app.model.TorrentListUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Tests for Stage 1 of lazy engine startup: Cache integration in ViewModel.
 *
 * These tests verify that:
 * 1. ViewModel shows cached data before engine loads
 * 2. Engine state wins when available (transitions from cache to live)
 * 3. Load is called on cache during initialization
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TorrentListViewModelCacheTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var repository: FakeTorrentRepository
    private lateinit var cache: FakeTorrentSummaryCache
    private lateinit var viewModel: TorrentListViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = FakeTorrentRepository()
        cache = FakeTorrentSummaryCache()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): TorrentListViewModel {
        return TorrentListViewModel(repository, cache)
    }

    // =========================================================================
    // Cache loading tests
    // =========================================================================

    @Test
    fun `emits cached data before engine connects`() = runTest {
        // Given: cache has 2 torrents, engine not started
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1", name = "Cached Torrent 1", progress = 0.5),
            createTestCachedSummary(infoHash = "hash2", name = "Cached Torrent 2", progress = 0.25)
        ))

        // When: ViewModel initializes (engine not loaded)
        viewModel = createViewModel()
        advanceUntilIdle()

        // Then: uiState emits Loaded with 2 cached torrents
        val state = viewModel.uiState.value
        assertTrue("Expected Loaded state but got $state", state is TorrentListUiState.Loaded)

        val loaded = state as TorrentListUiState.Loaded
        assertEquals(2, loaded.torrents.size)
        assertEquals("hash1", loaded.torrents[0].infoHash)
        assertEquals("Cached Torrent 1", loaded.torrents[0].name)
        assertEquals(0.5, loaded.torrents[0].progress, 0.001)

        // Cached torrents should have 0 speeds
        assertEquals(0L, loaded.torrents[0].downloadSpeed)
        assertEquals(0L, loaded.torrents[0].uploadSpeed)
    }

    @Test
    fun `transitions to engine data when available`() = runTest {
        // Given: cache has 2 torrents (progress 50%)
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1", name = "Cached Name", progress = 0.5)
        ))

        viewModel = createViewModel()
        advanceUntilIdle()

        // Verify we start with cached data
        var state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(0.5, state.torrents[0].progress, 0.001)
        assertEquals("Cached Name", state.torrents[0].name)

        // When: engine starts and pushes state (progress 75%, different name)
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent(infoHash = "hash1", name = "Engine Name", progress = 0.75, downloadSpeed = 5000)
        ))
        advanceUntilIdle()

        // Then: uiState shows 75% progress (engine wins)
        state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(0.75, state.torrents[0].progress, 0.001)
        assertEquals("Engine Name", state.torrents[0].name)
        assertEquals(5000L, state.torrents[0].downloadSpeed)
    }

    @Test
    fun `engine state always wins when loaded`() = runTest {
        // Given: cache has 3 torrents
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1", name = "Cached 1"),
            createTestCachedSummary(infoHash = "hash2", name = "Cached 2"),
            createTestCachedSummary(infoHash = "hash3", name = "Cached 3")
        ))

        viewModel = createViewModel()
        advanceUntilIdle()

        // When: engine loads with only 2 torrents (one was removed)
        repository.setLoaded(true)
        repository.setTorrents(listOf(
            createTestTorrent(infoHash = "hash1", name = "Live 1"),
            createTestTorrent(infoHash = "hash2", name = "Live 2")
        ))
        advanceUntilIdle()

        // Then: only engine's 2 torrents shown (not cache's 3)
        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertEquals(2, state.torrents.size)
        assertEquals("Live 1", state.torrents[0].name)
        assertEquals("Live 2", state.torrents[1].name)
    }

    @Test
    fun `shows loading when no cache and engine not loaded`() = runTest {
        // Given: empty cache, engine not loaded
        viewModel = createViewModel()
        advanceUntilIdle()

        // Then: state is Loading
        assertEquals(TorrentListUiState.Loading, viewModel.uiState.value)
    }

    @Test
    fun `load is called on cache during initialization`() = runTest {
        // Given: cache with some data
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1")
        ))

        // When: ViewModel initializes
        viewModel = createViewModel()
        advanceUntilIdle()

        // Then: cache.load() was called
        assertTrue("cache.load() should have been called", cache.wasLoadCalled())
    }

    @Test
    fun `empty engine state shows empty list not cache`() = runTest {
        // Given: cache has torrents
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1", name = "Cached")
        ))

        viewModel = createViewModel()
        advanceUntilIdle()

        // When: engine loads with empty list
        repository.setLoaded(true)
        repository.setTorrents(emptyList())
        advanceUntilIdle()

        // Then: empty list from engine, not cached data
        val state = viewModel.uiState.value as TorrentListUiState.Loaded
        assertTrue(state.torrents.isEmpty())
    }

    @Test
    fun `error state shows before engine loaded even with cache`() = runTest {
        // Given: cache has torrents
        cache.setCachedSummaries(listOf(
            createTestCachedSummary(infoHash = "hash1")
        ))

        viewModel = createViewModel()
        advanceUntilIdle()

        // When: engine fails to load
        repository.setError("Engine crashed")
        advanceUntilIdle()

        // Then: error state is shown (not cache)
        val state = viewModel.uiState.value
        assertTrue("Expected Error state but got $state", state is TorrentListUiState.Error)
        assertEquals("Engine crashed", (state as TorrentListUiState.Error).message)
    }

    // =========================================================================
    // ViewModel without cache (backwards compatibility)
    // =========================================================================

    @Test
    fun `works without cache parameter`() = runTest {
        // Given: ViewModel created without cache
        val viewModelWithoutCache = TorrentListViewModel(repository)
        advanceUntilIdle()

        // When: engine loads
        repository.setLoaded(true)
        repository.setTorrents(listOf(createTestTorrent(infoHash = "hash1", name = "Test")))
        advanceUntilIdle()

        // Then: works normally
        val state = viewModelWithoutCache.uiState.value as TorrentListUiState.Loaded
        assertEquals(1, state.torrents.size)
        assertEquals("Test", state.torrents[0].name)
    }

    @Test
    fun `loading state without cache when engine not ready`() = runTest {
        // Given: no cache provided
        val viewModelWithoutCache = TorrentListViewModel(repository)
        advanceUntilIdle()

        // Then: Loading state (no cache fallback)
        assertEquals(TorrentListUiState.Loading, viewModelWithoutCache.uiState.value)
    }
}
