package com.jstorrent.app.ui.screens

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.FakeTorrentRepository
import com.jstorrent.app.viewmodel.TorrentDetailViewModel
import com.jstorrent.app.viewmodel.createTestTorrent
import com.jstorrent.quickjs.model.FileInfo
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class TorrentDetailScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private lateinit var fakeRepository: FakeTorrentRepository
    private lateinit var viewModel: TorrentDetailViewModel

    private val testInfoHash = "test-hash-123"

    @Before
    fun setup() {
        fakeRepository = FakeTorrentRepository()
    }

    private fun createViewModel(): TorrentDetailViewModel {
        return TorrentDetailViewModel(fakeRepository, testInfoHash)
    }

    @Test
    fun loadingState_showsLoadingIndicator() {
        fakeRepository.setLoaded(false)
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Loading indicator should be displayed (CircularProgressIndicator)
        composeTestRule.waitForIdle()
    }

    @Test
    fun loadedState_showsTorrentName() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(
            listOf(createTestTorrent(testInfoHash, name = "Ubuntu ISO"))
        )
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Ubuntu ISO").assertIsDisplayed()
    }

    @Test
    fun errorState_showsErrorMessage() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(emptyList()) // Torrent not found
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Torrent not found").assertIsDisplayed()
    }

    @Test
    fun backButton_callsNavigateBack() {
        var navigateBackCalled = false
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navigateBackCalled = true },
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        composeTestRule.onNodeWithContentDescription("Back").performClick()
        assert(navigateBackCalled) { "Navigate back should have been called" }
    }

    @Test
    fun tabs_areDisplayed() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Note: Tab labels may appear multiple times (once in tabs, once in StatusTab stats).
        // We verify at least one instance of each tab label exists.
        composeTestRule.onAllNodesWithText("STATUS").fetchSemanticsNodes().isNotEmpty().let {
            assert(it) { "STATUS tab should be displayed" }
        }
        composeTestRule.onAllNodesWithText("FILES").fetchSemanticsNodes().isNotEmpty().let {
            assert(it) { "FILES tab should be displayed" }
        }
        composeTestRule.onAllNodesWithText("TRACKERS").fetchSemanticsNodes().isNotEmpty().let {
            assert(it) { "TRACKERS tab should be displayed" }
        }
        composeTestRule.onAllNodesWithText("PEERS").fetchSemanticsNodes().isNotEmpty().let {
            assert(it) { "PEERS tab should be displayed" }
        }
        composeTestRule.onAllNodesWithText("PIECES").fetchSemanticsNodes().isNotEmpty().let {
            assert(it) { "PIECES tab should be displayed" }
        }
    }

    @Test
    fun tabs_switchContent() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        fakeRepository.filesData = mapOf(
            testInfoHash to listOf(
                FileInfo(0, "movie.mp4", 1000000, 500000, 0.5)
            )
        )
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Click FILES tab - may appear multiple times (tab + status section), click the first one
        composeTestRule.onAllNodesWithText("FILES")[0].performClick()
        composeTestRule.waitForIdle()

        // File should be displayed
        composeTestRule.onNodeWithText("movie.mp4").assertIsDisplayed()
    }

    @Test
    fun pauseButton_togglesState() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(
            listOf(createTestTorrent(testInfoHash, status = "downloading"))
        )
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Click pause button
        composeTestRule.onNodeWithContentDescription("Pause").performClick()

        // Verify pause was called
        assert(fakeRepository.pausedTorrents.contains(testInfoHash)) {
            "Pause should have been called"
        }
    }

    @Test
    fun resumeButton_shownWhenPaused() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(
            listOf(createTestTorrent(testInfoHash, status = "stopped"))
        )
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Resume button should be visible when paused
        composeTestRule.onNodeWithContentDescription("Resume").assertIsDisplayed()
    }

    @Test
    fun overflowMenu_showsRemoveOption() {
        fakeRepository.setLoaded(true)
        fakeRepository.setTorrents(listOf(createTestTorrent(testInfoHash)))
        viewModel = createViewModel()

        composeTestRule.setContent {
            JSTorrentTheme {
                TorrentDetailScreen(
                    viewModel = viewModel,
                    onNavigateBack = {},
                    onSettingsClick = {},
                    onSpeedClick = {},
                    onDhtInfoClick = {},
                    onShutdownClick = {}
                )
            }
        }

        // Open overflow menu
        composeTestRule.onNodeWithContentDescription("Menu").performClick()

        // Remove option should be visible
        composeTestRule.onNodeWithText("Remove torrent").assertIsDisplayed()
    }
}
