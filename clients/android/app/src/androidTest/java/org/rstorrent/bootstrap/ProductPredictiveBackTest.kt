package org.rstorrent.bootstrap

import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProductPredictiveBackTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun systemBackCanArriveAsTheLastDetailRouteIsPopped() {
        lateinit var navigation: NavHostController
        lateinit var back: OnBackPressedDispatcher
        compose.setContent {
            navigation = rememberNavController()
            back = requireNotNull(LocalOnBackPressedDispatcherOwner.current).onBackPressedDispatcher
            NavHost(navigation, startDestination = "library") {
                composable("library") { Text("Library") }
                composable("details") { Text("Details") }
            }
        }
        compose.onNodeWithText("Library").assertIsDisplayed()
        compose.runOnIdle { navigation.navigate("details") }
        compose.onNodeWithText("Details").assertIsDisplayed()
        compose.waitForIdle()

        compose.mainClock.autoAdvance = false
        try {
            compose.runOnIdle {
                assertTrue(navigation.popBackStack())
                back.dispatchOnBackStarted(BackEventCompat(0f, 0f, 0.1f, BackEventCompat.EDGE_LEFT))
                back.onBackPressed()
            }
        } finally {
            compose.mainClock.autoAdvance = true
        }
        compose.onNodeWithText("Library").assertIsDisplayed()
    }
}
