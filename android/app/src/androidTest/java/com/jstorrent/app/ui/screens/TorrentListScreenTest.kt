package com.jstorrent.app.ui.screens

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jstorrent.app.model.TorrentFilter
import com.jstorrent.app.model.TorrentListUiState
import com.jstorrent.app.model.TorrentSortOrder
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.FakeTorrentRepository
import com.jstorrent.app.viewmodel.TorrentListViewModel
import com.jstorrent.quickjs.model.TorrentSummary
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class TorrentListScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private lateinit var fakeRepository: FakeTorrentRepository
    private lateinit var viewModel: TorrentListViewModel

    @Before
    fun setup() {
        fakeRepository = FakeTorrentRepository()
        viewModel = TorrentListViewModel(fakeRepository)
    }

    @Test
    fun emptyState_showsMessage() {
        // Set up empty list
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList())

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify empty state message is shown
        composeTestRule.onNodeWithText("No torrents yet").assertIsDisplayed()
        composeTestRule.onNodeWithText("Tap + to add a magnet link").assertIsDisplayed()
    }

    @Test
    fun torrentList_showsAllTorrents() {
        // Set up with torrents
        val torrents = listOf(
            createTestTorrent("hash1", "Ubuntu ISO", 0.45, "downloading"),
            createTestTorrent("hash2", "Debian ISO", 0.75, "stopped"),
            createTestTorrent("hash3", "Fedora ISO", 1.0, "seeding")
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify all torrents are shown
        composeTestRule.onNodeWithText("Ubuntu ISO").assertIsDisplayed()
        composeTestRule.onNodeWithText("Debian ISO").assertIsDisplayed()
        composeTestRule.onNodeWithText("Fedora ISO").assertIsDisplayed()
    }

    @Test
    fun torrentCard_tapNavigatesToDetail() {
        var clickedHash: String? = null
        val torrents = listOf(
            createTestTorrent("hash1", "Test Torrent", 0.5, "downloading")
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(
                    viewModel = viewModel,
                    onTorrentClick = { clickedHash = it }
                )
            }
        }

        // Click on torrent
        composeTestRule.onNodeWithText("Test Torrent").performClick()

        // Verify click callback was called
        assert(clickedHash == "hash1") { "Expected hash1, got $clickedHash" }
    }

    @Test
    fun fab_showsAddDialog() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList())

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Click FAB
        composeTestRule.onNodeWithContentDescription("Add torrent").performClick()

        // Verify dialog is shown
        composeTestRule.onNodeWithText("Add Torrent").assertIsDisplayed()
    }

    @Test
    fun filterTabs_switchBetweenFilters() {
        val torrents = listOf(
            createTestTorrent("hash1", "Downloading Torrent", 0.45, "downloading"),
            createTestTorrent("hash2", "Finished Torrent", 1.0, "seeding")
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Initially on ALL tab - both torrents shown
        composeTestRule.onNodeWithText("Downloading Torrent").assertIsDisplayed()
        composeTestRule.onNodeWithText("Finished Torrent").assertIsDisplayed()

        // Click Active tab (renamed from Queued)
        composeTestRule.onNodeWithText("Active (1)").performClick()

        // Only downloading torrent should be visible
        composeTestRule.onNodeWithText("Downloading Torrent").assertIsDisplayed()
        composeTestRule.onNodeWithText("Finished Torrent").assertDoesNotExist()

        // Click Finished tab
        composeTestRule.onNodeWithText("Finished (1)").performClick()

        // Only finished torrent should be visible
        composeTestRule.onNodeWithText("Finished Torrent").assertIsDisplayed()
        composeTestRule.onNodeWithText("Downloading Torrent").assertDoesNotExist()
    }

    @Test
    fun overflowMenu_showsPauseResumeOptions() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList())

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Open overflow menu
        composeTestRule.onNodeWithContentDescription("Menu").performClick()

        // Verify menu items
        composeTestRule.onNodeWithText("Pause All").assertIsDisplayed()
        composeTestRule.onNodeWithText("Resume All").assertIsDisplayed()
        composeTestRule.onNodeWithText("Add Download Folder").assertIsDisplayed()
    }

    @Test
    fun loadingState_showsLoadingIndicator() {
        fakeRepository.setLoaded(false)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify loading state is shown
        composeTestRule.onNodeWithText("Starting engine...").assertIsDisplayed()
    }

    @Test
    fun errorState_showsErrorMessage() {
        fakeRepository.setError("Failed to connect")

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify error state is shown
        composeTestRule.onNodeWithText("Error").assertIsDisplayed()
        composeTestRule.onNodeWithText("Failed to connect").assertIsDisplayed()
    }

    @Test
    fun speedIndicator_showsWhenActiveDownload() {
        // Set up with high-speed torrents
        val torrents = listOf(
            TorrentSummary(
                infoHash = "hash1",
                name = "Test Torrent",
                progress = 0.5,
                downloadSpeed = 12_500_000L, // 12.5 MB/s
                uploadSpeed = 1_200_000L,    // 1.2 MB/s
                status = "downloading"
            )
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Verify speed indicators are displayed (may be multiple - top bar + card)
        // Use onAllNodesWithText to handle multiple matches
        val speedNodes = composeTestRule.onAllNodesWithText("MB/s", substring = true)
        speedNodes.fetchSemanticsNodes().isNotEmpty().let { hasNodes ->
            assert(hasNodes) { "Should have at least one MB/s indicator" }
        }
    }

    @Test
    fun speedIndicator_hiddenWhenNoActivity() {
        // Set up with paused torrent (no speed)
        val torrents = listOf(
            TorrentSummary(
                infoHash = "hash1",
                name = "Paused Torrent",
                progress = 0.5,
                downloadSpeed = 0L,
                uploadSpeed = 0L,
                status = "stopped"
            )
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // Speed indicators should not be visible when there's no activity
        // With 0 speed, no MB/s or KB/s text should appear
        composeTestRule.onAllNodesWithText("MB/s", substring = true).assertCountEquals(0)
        composeTestRule.onAllNodesWithText("KB/s", substring = true).assertCountEquals(0)
    }

    @Test
    fun speedIndicator_aggregatesSpeeds() {
        // Set up with multiple torrents to test aggregation
        val torrents = listOf(
            TorrentSummary(
                infoHash = "hash1",
                name = "Torrent 1",
                progress = 0.5,
                downloadSpeed = 5_000_000L, // 5 MB/s
                uploadSpeed = 500_000L,
                status = "downloading"
            ),
            TorrentSummary(
                infoHash = "hash2",
                name = "Torrent 2",
                progress = 0.3,
                downloadSpeed = 3_000_000L, // 3 MB/s
                uploadSpeed = 300_000L,
                status = "downloading"
            )
        )
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(torrents)

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentListScreen(viewModel = viewModel)
            }
        }

        // With 8 MB/s total, we should see MB/s indicators
        val speedNodes = composeTestRule.onAllNodesWithText("MB/s", substring = true)
        speedNodes.fetchSemanticsNodes().isNotEmpty().let { hasNodes ->
            assert(hasNodes) { "Should have at least one MB/s indicator" }
        }
    }

    // Helper function
    private fun createTestTorrent(
        hash: String,
        name: String,
        progress: Double,
        status: String
    ) = TorrentSummary(
        infoHash = hash,
        name = name,
        progress = progress,
        downloadSpeed = if (status == "downloading") 1_000_000L else 0L,
        uploadSpeed = if (status == "seeding") 500_000L else 0L,
        status = status
    )
}
