package com.jstorrent.app.ui.dialogs

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.jstorrent.app.ui.theme.JSTorrentTheme
import org.junit.Rule
import org.junit.Test

class AddTorrentDialogTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun emptyInput_addButtonDisabled() {
        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = false
                )
            }
        }

        // Verify Add button is disabled
        composeTestRule.onNodeWithText("Add").assertIsNotEnabled()
    }

    @Test
    fun validMagnet_addButtonEnabled() {
        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "magnet:?xt=urn:btih:abc123",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = true
                )
            }
        }

        // Verify Add button is enabled
        composeTestRule.onNodeWithText("Add").assertIsEnabled()
    }

    @Test
    fun addButton_callsCallback() {
        var addCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "magnet:?xt=urn:btih:abc123",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = { addCalled = true },
                    onCancel = {},
                    isAddEnabled = true
                )
            }
        }

        // Click Add button
        composeTestRule.onNodeWithText("Add").performClick()

        // Verify callback was called
        assert(addCalled) { "Expected onAddTorrent to be called" }
    }

    @Test
    fun cancelButton_callsCallback() {
        var cancelCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = { cancelCalled = true },
                    isAddEnabled = false
                )
            }
        }

        // Click Cancel button
        composeTestRule.onNodeWithText("Cancel").performClick()

        // Verify callback was called
        assert(cancelCalled) { "Expected onCancel to be called" }
    }

    @Test
    fun pasteButton_callsCallback() {
        var pasteCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = { pasteCalled = true },
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = false
                )
            }
        }

        // Click paste button
        composeTestRule.onNodeWithContentDescription("Paste from clipboard").performClick()

        // Verify callback was called
        assert(pasteCalled) { "Expected onPasteFromClipboard to be called" }
    }

    @Test
    fun textInput_triggersOnChange() {
        var inputValue = ""

        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = inputValue,
                    onMagnetLinkChange = { inputValue = it },
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = inputValue.isNotBlank()
                )
            }
        }

        // Type in the text field
        composeTestRule.onNodeWithText("Magnet link").performTextInput("magnet:?xt=urn:btih:test")

        // Verify the callback was triggered
        assert(inputValue == "magnet:?xt=urn:btih:test") {
            "Expected input to be 'magnet:?xt=urn:btih:test', got '$inputValue'"
        }
    }

    @Test
    fun dialogTitle_isDisplayed() {
        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = false
                )
            }
        }

        // Verify title is displayed
        composeTestRule.onNodeWithText("Add Torrent").assertIsDisplayed()
    }

    @Test
    fun magnetLinkField_isDisplayed() {
        composeTestRule.setContent {
            JSTorrentTheme {
                AddTorrentContent(
                    magnetLink = "",
                    onMagnetLinkChange = {},
                    onPasteFromClipboard = {},
                    onBrowseForFile = {},
                    onAddTorrent = {},
                    onCancel = {},
                    isAddEnabled = false
                )
            }
        }

        // Verify the magnet link text field label is displayed
        composeTestRule.onNodeWithText("Magnet link").assertIsDisplayed()
        // Verify paste button is displayed
        composeTestRule.onNodeWithContentDescription("Paste from clipboard").assertIsDisplayed()
    }
}

// Unit tests for validation function
class MagnetLinkValidationTest {

    @Test
    fun validMagnetLink_returnsTrue() {
        assert(isValidMagnetLink("magnet:?xt=urn:btih:abc123"))
        assert(isValidMagnetLink("MAGNET:?XT=URN:BTIH:ABC123")) // case insensitive
        assert(isValidMagnetLink("  magnet:?xt=urn:btih:abc123  ")) // with whitespace
    }

    @Test
    fun invalidMagnetLink_returnsFalse() {
        assert(!isValidMagnetLink(""))
        assert(!isValidMagnetLink("http://example.com"))
        assert(!isValidMagnetLink("magnet:"))
        assert(!isValidMagnetLink("urn:btih:abc123"))
    }
}
