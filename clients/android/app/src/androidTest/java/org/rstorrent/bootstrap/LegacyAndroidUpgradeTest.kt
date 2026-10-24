package org.rstorrent.bootstrap

import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Process
import android.provider.DocumentsContract
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

/** Invoked in explicit phases by run-legacy-upgrade.py, never ordinary suites. */
class LegacyAndroidUpgradeTest {
    private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val enabled: Boolean get() = InstrumentationRegistry.getArguments().getString("legacyUpgrade") == "true"
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Test fun verifyReplacement() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        assertEquals(25L, context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode)
        assertEquals(File(context.filesDir, "legacy-upgrade-uid").readText(), Process.myUid().toString())
        assertEquals(File(context.filesDir,"legacy-upgrade-db-hash").readText(), hex(MessageDigest.getInstance("SHA-256").digest(context.getDatabasePath("jstorrent_kv.db").readBytes())))
        assertEquals(File(context.filesDir,"legacy-upgrade-roots-hash").readText(), hex(MessageDigest.getInstance("SHA-256").digest(File(context.filesDir,"roots.json").readBytes())))
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        if (android.os.Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(context.packageName, "android.permission.POST_NOTIFICATIONS")
        val serviceRule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (serviceRule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        try {
            val state = withTimeout(60000) { service.state.first { it.ready && it.torrents.size == 5 && it.clientSettings != null } }
            assertTrue(ProductNetworkPreference.read(context))
            assertFalse(ProductPowerPreference.read(context))
            assertTrue(ProductLifecyclePreferenceStore(context).read().keepSeedingEnabled)
            val settings = state.clientSettings!!.configured
            assertFalse(settings.dhtEnabled); assertFalse(settings.peerExchangeEnabled)
            assertEquals(77U, settings.peerConnectionLimit); assertEquals(3.toUShort(), settings.activeDownloads)
            assertEquals(org.rstorrent.session.uniffi.EncryptionPolicy.REQUIRED, settings.encryption)
            assertEquals(org.rstorrent.session.uniffi.ActiveSeedLimit.Limited(4.toUShort()), settings.activeSeeds)
            assertEquals(org.rstorrent.session.uniffi.TransferRateLimit.Limited(12345U), settings.uploadRateLimit)
            assertEquals(org.rstorrent.session.uniffi.TransferRateLimit.Limited(23456U), settings.downloadRateLimit)
            assertFalse(state.storage!!.showFileSelection)
            SQLiteDatabase.openDatabase(File(context.filesDir,"product-profile/session.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT count(*) FROM torrents WHERE desired_state != 'paused'", null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(0, rows.getInt(0)) }
                database.rawQuery("SELECT count(*) FROM legacy_android_import", null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(1, rows.getInt(0)) }
                database.rawQuery("SELECT download_queue_position, selection_default FROM torrents WHERE raw_info IS NULL", null).use { rows -> assertTrue(rows.moveToFirst()); assertTrue(rows.isNull(0)); assertEquals("skipped", rows.getString(1)) }
            }
            assertEquals(1, ProductSafRootRegistry.load(context).roots.size)
            val retainedRoot = File(context.filesDir,"legacy-upgrade-root-id")
            if (retainedRoot.exists()) assertEquals(retainedRoot.readText(), ProductSafRootRegistry.load(context).roots.single().rootId)
            assertEquals(1, context.contentResolver.persistedUriPermissions.count { it.isReadPermission && it.isWritePermission })
            assertEquals(1, state.torrents.values.count { !it.metadataAvailable })
            assertEquals(1, state.torrents.values.count { it.awaitingFileSelection })
            assertTrue(state.torrents.values.all { it.operationalState != org.rstorrent.session.uniffi.TorrentOperationalState.DOWNLOADING })
            withTimeout(60000) {
                while (true) {
                    val pending = SQLiteDatabase.openDatabase(File(context.filesDir,"product-profile/session.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                        database.rawQuery("SELECT count(*) FROM torrents WHERE raw_info IS NOT NULL AND awaiting_file_selection=0 AND verification_completed != verification_requested", null).use { rows -> rows.moveToFirst(); rows.getInt(0) }
                    }
                    if (pending == 0) break
                    delay(50)
                }
            }
            val checked = withTimeout(60000) { service.state.first { current -> current.torrents.values.count { it.verifiedPieceCount > 0U } >= 2 } }
            val intact = checked.torrents.values.single { it.displayName == "intact.bin" }; assertEquals(1U, intact.verifiedPieceCount)
            val private = checked.torrents.values.single { it.displayName == "private.bin" }; assertEquals(1U, private.verifiedPieceCount)
            val corrupt = checked.torrents.values.single { it.displayName == "corrupt.bin" }; assertEquals(0U, corrupt.verifiedPieceCount)
            val root = ProductSafRootRegistry.load(context).roots.single()
            val tree = Uri.parse(root.treeUri)
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val digests = mutableMapOf<String, String>()
            context.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)!!.use { rows ->
                while (rows.moveToNext()) {
                    val name = rows.getString(1)
                    if (name in listOf("intact.bin", "corrupt.bin")) {
                        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, rows.getString(0))
                        val bytes = context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                        assertEquals(16384, bytes.size)
                        digests[name] = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
                    }
                }
            }
            assertEquals(hex(MessageDigest.getInstance("SHA-256").digest(ByteArray(16384) { 37 })), digests["intact.bin"])
            assertEquals(hex(MessageDigest.getInstance("SHA-256").digest(ByteArray(16384) { 38 })), digests["corrupt.bin"])
            assertArrayEquals(ByteArray(16384) { 37 }, File(context.filesDir,"downloads/private.bin").readBytes())
        } finally { serviceRule.unbindService(); context.stopService(Intent(context, ProductEngineService::class.java)); ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false) }
    }
    @Test fun verifyOrdinaryWriterUpgrade() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        val encoded = InstrumentationRegistry.getArguments().getString("writerSpec")!!
        val spec = org.json.JSONObject(String(android.util.Base64.decode(encoded, android.util.Base64.DEFAULT), Charsets.UTF_8))
        assertEquals(spec.getInt("uid"), Process.myUid())
        val cases = spec.getJSONArray("cases")
        val sourceRoots = org.json.JSONObject(File(context.filesDir, "roots.json").readText()).getJSONArray("roots")
        assertEquals(2, sourceRoots.length())
        val expectedRoots = mutableMapOf<String, String>()
        for (index in 0 until sourceRoots.length()) {
            val root = sourceRoots.getJSONObject(index)
            val folder = DocumentsContract.getTreeDocumentId(Uri.parse(root.getString("uri"))).substringAfterLast('/')
            expectedRoots[folder] = root.getString("key")
        }
        // Read retained source; the old product, not fixture SQL, wrote this state.
        SQLiteDatabase.openDatabase(context.getDatabasePath("jstorrent_kv.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            fun read(key: String): String = database.rawQuery("SELECT value FROM kv WHERE key=?", arrayOf(key)).use { rows ->
                assertTrue("missing ordinary source key $key", rows.moveToFirst())
                rows.getString(0)
            }
            assertEquals(2, org.json.JSONObject(read("session:torrents")).getJSONArray("torrents").length())
            assertEquals("false", read("config:dhtEnabled"))
            assertEquals("false", read("config:pexEnabled"))
            assertEquals("\"disabled\"", read("config:encryptionPolicy"))
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index)
                val source = org.json.JSONObject(read("session:torrent:${case.getString("hash")}:state"))
                assertEquals(expectedRoots[case.getString("folder")], source.getString("storageKey"))
                assertEquals(if (index == 0) "stopped" else "active", source.getString("userState"))
                assertTrue("old app did not persist downloaded progress", source.getLong("downloaded") > 0)
                if (index == 1) assertTrue("source was already complete before upgrade", source.getLong("downloaded") < case.getInt("size"))
            }
        }
        val expectedWifi = spec.optBoolean("wifi_only_enabled", true)
        assertEquals(expectedWifi, context.getSharedPreferences("jstorrent_settings", Context.MODE_PRIVATE).getBoolean("wifi_only_enabled", false))
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        val rule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (rule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        try {
            val state = withTimeout(90000) {
                service.state.first { current -> current.ready && current.torrents.size == 2 && current.clientSettings != null &&
                    (0 until cases.length()).all { index ->
                        val case = cases.getJSONObject(index)
                        current.torrents.values.any { it.displayName == case.getString("name") && it.verifiedPieceCount == case.getInt("pieces").toUInt() }
                    }
                }
            }
            assertEquals(expectedWifi, ProductNetworkPreference.read(context))
            assertTrue(ProductLegacyAndroidMigration.hasMigratedSource(context))
            assertFalse(state.clientSettings!!.configured.dhtEnabled)
            assertFalse(state.clientSettings!!.configured.peerExchangeEnabled)
            assertEquals(org.rstorrent.session.uniffi.EncryptionPolicy.DISABLED, state.clientSettings!!.configured.encryption)
            assertEquals(2, state.storage!!.roots.size)
            assertEquals(2, context.contentResolver.persistedUriPermissions.count { it.isReadPermission && it.isWritePermission })
            SQLiteDatabase.openDatabase(File(context.filesDir, "product-profile/session.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT report_json FROM legacy_android_import", null).use { rows ->
                    assertTrue(rows.moveToFirst())
                    val report = org.json.JSONObject(rows.getString(0))
                    assertEquals(2, report.getInt("imported"))
                    assertEquals(0, report.getInt("skipped"))
                }
                database.rawQuery("SELECT count(*) FROM torrents WHERE desired_state='paused'", null).use { rows -> rows.moveToFirst(); assertEquals(1, rows.getInt(0)) }
            }
            val registry = ProductSafRootRegistry.load(context)
            assertEquals(2, registry.roots.size)
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index)
                val rootId = "legacy-android-${expectedRoots[case.getString("folder")]}"
                val root = registry.roots.single { it.rootId == rootId }
                val tree = Uri.parse(root.treeUri)
                val document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree) + "/" + case.getString("name"))
                val bytes = context.contentResolver.openInputStream(document)!!.use { it.readBytes() }
                assertEquals(case.getInt("size"), bytes.size)
                assertEquals(case.getString("sha256"), hex(MessageDigest.getInstance("SHA-256").digest(bytes)))
            }
        } finally {
            rule.unbindService()
            context.stopService(Intent(context, ProductEngineService::class.java))
            ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false)
        }
    }

    /** Explicit owned-emulator transport rehearsal; phone product guard stays on. */
    @Test fun serveMigratedCompanion() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        val ready = File(context.cacheDir, "t248-companion-ready")
        val finished = File(context.cacheDir, "t248-companion-finished")
        ready.delete(); finished.delete()
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        val rule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (rule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        // Access the existing sole owner: do not open another engine/profile.
        val field = ProductEngineService::class.java.getDeclaredField("client").apply { isAccessible = true }
        var client: org.rstorrent.bootstrap.uniffi.AndroidApplicationClient? = null
        try {
            withTimeout(60000) { service.state.first { it.ready && it.torrents.size == 2 } }
            assertTrue(ProductLegacyAndroidMigration.hasMigratedSource(context))
            client = field.get(service) as org.rstorrent.bootstrap.uniffi.AndroidApplicationClient
            assertEquals(3030.toUShort(), client.startChromeosCompanion())
            ready.writeText("ready")
            var approvals = 0
            withTimeout(120000) {
                while (!finished.exists()) {
                    client.pendingCompanionPairing()?.let { pending ->
                        client.approveCompanionPairing(pending.requestId)
                        approvals += 1
                    }
                    delay(100)
                }
            }
            assertEquals("fresh successor pairing", 1, approvals)
            withTimeout(20000) {
                while (true) {
                    val paused = SQLiteDatabase.openDatabase(File(context.filesDir, "product-profile/session.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                        database.rawQuery("SELECT count(*) FROM torrents WHERE desired_state='paused'", null).use { rows -> rows.moveToFirst(); rows.getInt(0) }
                    }
                    if (paused == 2) break
                    delay(100)
                }
            }
        } finally {
            client?.stopChromeosCompanion()
            ready.delete(); finished.delete()
            rule.unbindService()
            context.stopService(Intent(context, ProductEngineService::class.java))
            ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false)
        }
    }

    @Test fun revokeGrant() {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        val root = ProductSafRootRegistry.load(context).roots.single()
        context.contentResolver.releasePersistableUriPermission(Uri.parse(root.treeUri), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        assertFalse(ProductSafDocuments.hasGrant(context, Uri.parse(root.treeUri)))
        File(context.filesDir,"legacy-upgrade-root-id").writeText(root.rootId)
    }

    @Test fun verifyRevoked() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        val rule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (rule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        try {
            val rootId = File(context.filesDir,"legacy-upgrade-root-id").readText()
            val state = withTimeout(60000) { service.state.first { current -> current.ready && current.torrents.size == 5 && current.storage?.roots?.any { it.rootId == rootId && it.availability == org.rstorrent.session.uniffi.StorageRootAvailability.UNAVAILABLE } == true } }
            assertEquals(5, state.torrents.size)
            assertEquals(rootId, ProductSafRootRegistry.load(context).roots.single().rootId)
            assertFalse(ProductSafDocuments.hasGrant(context, Uri.parse(ProductSafRootRegistry.load(context).roots.single().treeUri)))
            // Root health is authoritative even for paused/pending torrent views.
            assertFalse(state.storageRootReady)
            assertTrue(state.torrents.values.all { it.activePeerConnections == 0U })
        } finally { rule.unbindService(); context.stopService(Intent(context, ProductEngineService::class.java)); ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false) }
    }

    @Test fun verifyClearDoesNotReimport() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        // Exercise the same fixed private-profile primitive as the clear workflow.
        ProductPrivateProfileReset.reset(context.filesDir)
        ProductSafRootRegistry.clearForTest(context)
        ProductNetworkPreference.reset(context)
        ProductPowerPreference.reset(context)
        ProductLifecyclePreferenceStore(context).reset()
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        val rule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (rule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        try {
            val state = withTimeout(60000) { service.state.first { it.ready && it.storage != null && it.clientSettings != null } }
            assertTrue(state.storage!!.roots.isEmpty())
            assertTrue(state.torrents.isEmpty())
            SQLiteDatabase.openDatabase(File(context.filesDir,"product-profile/session.db").absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT count(*) FROM torrents", null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(0, rows.getInt(0)) }
                database.rawQuery("SELECT count(*) FROM sqlite_master WHERE name='legacy_android_import'", null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(0, rows.getInt(0)) }
            }
            assertFalse(ProductNetworkPreference.read(context))
            assertArrayEquals(ByteArray(16384) { 37 }, File(context.filesDir,"downloads/private.bin").readBytes())
            assertEquals(File(context.filesDir,"legacy-upgrade-db-hash").readText(), hex(MessageDigest.getInstance("SHA-256").digest(context.getDatabasePath("jstorrent_kv.db").readBytes())))
        } finally { rule.unbindService(); context.stopService(Intent(context, ProductEngineService::class.java)); ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false) }
    }

    @Test fun verifyRootOnlyMigration() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        context.deleteDatabase("jstorrent_kv.db")
        resetFixtureBootstrap()
        verifyEmptyStartup(expectedRoots = 1, expectedUnmetered = true)
    }

    @Test fun verifyFreshInstall() = runBlocking {
        org.junit.Assume.assumeTrue("requires owned upgrade runner", enabled)
        File(context.filesDir,"roots.json").delete()
        check(context.getSharedPreferences("jstorrent_settings", Context.MODE_PRIVATE).edit().clear().commit())
        resetFixtureBootstrap()
        verifyEmptyStartup(expectedRoots = 0, expectedUnmetered = false)
    }

    private fun resetFixtureBootstrap() {
        ProductPrivateProfileReset.reset(context.filesDir)
        ProductSafRootRegistry.clearForTest(context)
        ProductNetworkPreference.reset(context)
        check(context.getSharedPreferences("product-legacy-bootstrap", Context.MODE_PRIVATE).edit().clear().commit())
    }

    private suspend fun verifyEmptyStartup(expectedRoots: Int, expectedUnmetered: Boolean) {
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        val rule = androidx.test.rule.ServiceTestRule.withTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val service = (rule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        try {
            val state = withTimeout(60000) { service.state.first { it.ready && it.storage != null && it.clientSettings != null } }
            assertEquals(expectedRoots, state.storage!!.roots.size)
            assertTrue(state.torrents.isEmpty())
            assertEquals(expectedUnmetered, ProductNetworkPreference.read(context))
            assertTrue(context.getSharedPreferences("product-legacy-bootstrap", Context.MODE_PRIVATE).getBoolean("complete",false))
            SQLiteDatabase.openDatabase(File(context.filesDir,"product-profile/session.db").absolutePath,null,SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT count(*) FROM torrents",null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(0,rows.getInt(0)) }
                if (expectedRoots == 0) database.rawQuery("SELECT count(*) FROM sqlite_master WHERE name='legacy_android_import'",null).use { rows -> assertTrue(rows.moveToFirst()); assertEquals(0,rows.getInt(0)) }
            }
            assertFalse(context.getDatabasePath("jstorrent_kv.db").exists())
        } finally { rule.unbindService(); context.stopService(Intent(context, ProductEngineService::class.java)); ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false) }
    }

}
