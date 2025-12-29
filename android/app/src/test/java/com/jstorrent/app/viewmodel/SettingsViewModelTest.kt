package com.jstorrent.app.viewmodel

import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.storage.RootStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var app: JSTorrentApplication
    private lateinit var rootStore: RootStore
    private lateinit var settingsStore: SettingsStore
    private lateinit var viewModel: SettingsViewModel

    private val testRoot1 = DownloadRoot(
        key = "key1",
        uri = "content://test1",
        displayName = "Downloads",
        removable = false,
        lastStatOk = true,
        lastChecked = System.currentTimeMillis()
    )

    private val testRoot2 = DownloadRoot(
        key = "key2",
        uri = "content://test2",
        displayName = "SD Card",
        removable = true,
        lastStatOk = false,
        lastChecked = System.currentTimeMillis()
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        app = mock {
            on { engineController } doReturn null
        }
        rootStore = mock()
        settingsStore = mock {
            on { defaultRootKey } doReturn null
            on { downloadSpeedLimit } doReturn 0
            on { uploadSpeedLimit } doReturn 0
            on { whenDownloadsComplete } doReturn "stop_and_close"
            on { wifiOnlyEnabled } doReturn false
            on { dhtEnabled } doReturn true
            on { pexEnabled } doReturn true
            on { encryptionPolicy } doReturn "allow"
        }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // =========================================================================
    // Initial state tests
    // =========================================================================

    @Test
    fun `initial state loads roots from store`() {
        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot1, testRoot2))

        viewModel = SettingsViewModel(app, rootStore, settingsStore)

        val state = viewModel.uiState.value
        assertEquals(2, state.downloadRoots.size)
        assertEquals("key1", state.downloadRoots[0].key)
        assertEquals("key2", state.downloadRoots[1].key)
    }

    @Test
    fun `initial state with empty roots`() {
        whenever(rootStore.refreshAvailability()).thenReturn(emptyList())

        viewModel = SettingsViewModel(app, rootStore, settingsStore)

        val state = viewModel.uiState.value
        assertTrue(state.downloadRoots.isEmpty())
    }

    // =========================================================================
    // Refresh tests
    // =========================================================================

    @Test
    fun `refreshRoots updates state`() {
        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot1))

        viewModel = SettingsViewModel(app, rootStore, settingsStore)

        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot1, testRoot2))

        viewModel.refreshRoots()

        val state = viewModel.uiState.value
        assertEquals(2, state.downloadRoots.size)
    }

    // =========================================================================
    // Remove root tests
    // =========================================================================

    @Test
    fun `removeRoot calls store and refreshes`() {
        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot1, testRoot2))
        whenever(rootStore.removeRoot("key1")).thenReturn(true)

        viewModel = SettingsViewModel(app, rootStore, settingsStore)

        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot2))

        viewModel.removeRoot("key1")

        verify(rootStore).removeRoot("key1")

        val state = viewModel.uiState.value
        assertEquals(1, state.downloadRoots.size)
        assertEquals("key2", state.downloadRoots[0].key)
    }

    // =========================================================================
    // Clear confirmation dialog tests
    // =========================================================================

    @Test
    fun `showClearConfirmation sets flag`() {
        whenever(rootStore.refreshAvailability()).thenReturn(emptyList())

        viewModel = SettingsViewModel(app, rootStore, settingsStore)

        viewModel.showClearConfirmation()

        assertTrue(viewModel.uiState.value.showClearConfirmation)
    }

    @Test
    fun `dismissClearConfirmation clears flag`() {
        whenever(rootStore.refreshAvailability()).thenReturn(emptyList())

        viewModel = SettingsViewModel(app, rootStore, settingsStore)
        viewModel.showClearConfirmation()
        viewModel.dismissClearConfirmation()

        assertFalse(viewModel.uiState.value.showClearConfirmation)
    }

    // =========================================================================
    // Clear all roots tests
    // =========================================================================

    @Test
    fun `clearAllRoots removes all roots and dismisses dialog`() {
        whenever(rootStore.listRoots()).thenReturn(listOf(testRoot1, testRoot2))
        whenever(rootStore.refreshAvailability()).thenReturn(listOf(testRoot1, testRoot2))
        whenever(rootStore.removeRoot("key1")).thenReturn(true)
        whenever(rootStore.removeRoot("key2")).thenReturn(true)

        viewModel = SettingsViewModel(app, rootStore, settingsStore)
        viewModel.showClearConfirmation()

        whenever(rootStore.refreshAvailability()).thenReturn(emptyList())

        viewModel.clearAllRoots()

        verify(rootStore).removeRoot("key1")
        verify(rootStore).removeRoot("key2")

        val state = viewModel.uiState.value
        assertTrue(state.downloadRoots.isEmpty())
        assertFalse(state.showClearConfirmation)
    }
}
