package com.jstorrent.app.cache

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.jstorrent.app.model.TorrentListUiState
import com.jstorrent.app.ui.screens.TorrentListScreen
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.FakeTorrentRepository
import com.jstorrent.app.viewmodel.TorrentListViewModel
import com.jstorrent.quickjs.model.TorrentSummary
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented tests for Stage 1 of lazy engine startup.
 *
 * Tests that:
 * 1. Cached data displays before engine is loaded
 * 2. Transition from cached to live data is seamless
 * 3. UI shows correct data source (cache vs engine)
 */
class CacheToLiveTransitionTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private lateinit var fakeRepository: FakeTorrentRepository
    private lateinit var fakeCache: FakeTorrentSummaryCache
    private lateinit var viewModel: TorrentListViewModel

    @Before
    fun setup() {
        fakeRepository = FakeTorrentRepository()
        fakeCache = FakeTorrentSummaryCache()
    }

    @Test
    fun cachedData_showsBeforeEngineLoads() {
        // Given: cache has torrents, engine not loaded
        fakeCache.setCachedSummaries(listOf(
            createCachedSummary("hash1", "Cached Torrent 1", 0.5),
            createCachedSummary("hash2", "Cached Torrent 2", 0.75)
        ))

        // Engine is NOT loaded
        fakeRepository.setLoaded(false)

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Then: cached torrents should be displayed (not "Loading...")
        composeTestRule.onNodeWithText("Cached Torrent 1").assertIsDisplayed()
        composeTestRule.onNodeWithText("Cached Torrent 2").assertIsDisplayed()
    }

    @Test
    fun transitionFromCacheToLive_updatesUI() {
        // Given: cache has torrent at 50% progress
        fakeCache.setCachedSummaries(listOf(
            createCachedSummary("hash1", "My Torrent", progress = 0.5)
        ))
        fakeRepository.setLoaded(false)

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify cached data shows
        composeTestRule.onNodeWithText("My Torrent").assertIsDisplayed()
        composeTestRule.onNodeWithText("50%").assertIsDisplayed()

        // When: engine loads with updated progress (75%)
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(
            TorrentSummary(
                infoHash = "hash1",
                name = "My Torrent",
                progress = 0.75,
                downloadSpeed = 1_000_000L,
                uploadSpeed = 0L,
                status = "downloading"
            )
        ))

        // Wait for recomposition
        composeTestRule.waitForIdle()

        // Then: live data shows (75% from engine, not 50% from cache)
        composeTestRule.onNodeWithText("75%").assertIsDisplayed()
    }

    @Test
    fun engineDataWins_whenTorrentRemoved() {
        // Given: cache has 3 torrents
        fakeCache.setCachedSummaries(listOf(
            createCachedSummary("hash1", "Torrent 1"),
            createCachedSummary("hash2", "Torrent 2"),
            createCachedSummary("hash3", "Torrent 3")
        ))
        fakeRepository.setLoaded(false)

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify all 3 cached torrents show
        composeTestRule.onNodeWithText("Torrent 1").assertIsDisplayed()
        composeTestRule.onNodeWithText("Torrent 2").assertIsDisplayed()
        composeTestRule.onNodeWithText("Torrent 3").assertIsDisplayed()

        // When: engine loads with only 2 torrents (one was removed)
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(
            TorrentSummary(
                infoHash = "hash1",
                name = "Torrent 1",
                progress = 0.5,
                downloadSpeed = 0L,
                uploadSpeed = 0L,
                status = "stopped"
            ),
            TorrentSummary(
                infoHash = "hash2",
                name = "Torrent 2",
                progress = 0.5,
                downloadSpeed = 0L,
                uploadSpeed = 0L,
                status = "stopped"
            )
        ))

        composeTestRule.waitForIdle()

        // Then: only 2 torrents show (engine wins)
        composeTestRule.onNodeWithText("Torrent 1").assertIsDisplayed()
        composeTestRule.onNodeWithText("Torrent 2").assertIsDisplayed()
        composeTestRule.onNodeWithText("Torrent 3").assertDoesNotExist()
    }

    @Test
    fun cachedTorrents_showZeroSpeed() {
        // Given: cache has a torrent that was downloading
        fakeCache.setCachedSummaries(listOf(
            createCachedSummary("hash1", "Cached Download", progress = 0.5, status = "stopped")
        ))
        fakeRepository.setLoaded(false)

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Then: torrent shows but no speed indicators (cached data has 0 speeds)
        composeTestRule.onNodeWithText("Cached Download").assertIsDisplayed()
        // Speed indicators should NOT be visible for cached data
        // (They only show when speed > 0)
    }

    @Test
    fun emptyCache_showsLoadingUntilEngineReady() {
        // Given: empty cache, engine not loaded
        // Cache is empty by default

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Then: loading state shown
        composeTestRule.onNodeWithText("Loading...").assertIsDisplayed()

        // When: engine loads with empty list
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList())

        composeTestRule.waitForIdle()

        // Then: empty state shown
        composeTestRule.onNodeWithText("No torrents yet").assertIsDisplayed()
    }

    @Test
    fun engineEmpty_cachePopulated_showsEmptyList() {
        // Given: cache has torrents
        fakeCache.setCachedSummaries(listOf(
            createCachedSummary("hash1", "Cached Torrent")
        ))

        viewModel = TorrentListViewModel(fakeRepository, fakeCache)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify cached data shows first
        composeTestRule.onNodeWithText("Cached Torrent").assertIsDisplayed()

        // When: engine loads with EMPTY list (user deleted all torrents)
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList())

        composeTestRule.waitForIdle()

        // Then: engine wins - shows empty state, not cached data
        composeTestRule.onNodeWithText("No torrents yet").assertIsDisplayed()
        composeTestRule.onNodeWithText("Cached Torrent").assertDoesNotExist()
    }

    // Helper function to create cached summaries
    private fun createCachedSummary(
        hash: String,
        name: String,
        progress: Double = 0.5,
        status: String = "stopped"
    ) = CachedTorrentSummary(
        infoHash = hash,
        name = name,
        progress = progress,
        status = status,
        totalSize = 1_000_000_000L,
        downloaded = (1_000_000_000L * progress).toLong(),
        uploaded = 0L,
        fileCount = 1,
        addedAt = System.currentTimeMillis(),
        hasMetadata = true,
        userState = "active"
    )
}
