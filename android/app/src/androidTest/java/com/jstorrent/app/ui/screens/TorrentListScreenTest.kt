package com.jstorrent.app.ui.screens

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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

        // Click Queued tab
        composeTestRule.onNodeWithText("Queued (1)").performClick()

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
