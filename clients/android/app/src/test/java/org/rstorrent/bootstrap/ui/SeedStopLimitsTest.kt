package org.rstorrent.bootstrap.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.ClientSettingsField
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.SettingsDraftState
import org.rstorrent.bootstrap.TorrentSettingsField
import org.rstorrent.bootstrap.fieldValues
import org.rstorrent.bootstrap.presentedTorrent
import org.rstorrent.bootstrap.seedStopLimits
import org.rstorrent.bootstrap.settingsFieldValues
import org.rstorrent.bootstrap.toClientSettingsPatch
import org.rstorrent.bootstrap.toTorrentSettingsPatch
import org.rstorrent.bootstrap.torrentSettingsPatch
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SeedStopLimit
import org.rstorrent.session.uniffi.SeedStopView
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentSeedStopLimit
import org.rstorrent.session.uniffi.TorrentSeedStopLimits
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit

class SeedStopLimitsTest {
    @Test
    fun ratioPickerOpensPresetsAsPresetsAndOtherValuesAsCustom() {
        assertEquals(listOf(100U, 150U, 200U, 300U, 500U), SEED_STOP_RATIO_PRESETS)
        assertEquals(
            SeedStopChoice.Preset(150U),
            seedStopChoice(TorrentSeedStopLimit.Limited(150U), SEED_STOP_RATIO_PRESETS),
        )
        assertEquals(
            SeedStopChoice.Custom,
            seedStopChoice(TorrentSeedStopLimit.Limited(125U), SEED_STOP_RATIO_PRESETS),
        )
        assertEquals(SeedStopChoice.Off, seedStopChoice(TorrentSeedStopLimit.Off, SEED_STOP_RATIO_PRESETS))
        assertEquals(
            SeedStopChoice.UseGlobal,
            seedStopChoice(TorrentSeedStopLimit.UseGlobal, SEED_STOP_RATIO_PRESETS),
        )

        assertEquals(TorrentSeedStopLimit.Limited(300U), SeedStopChoice.Preset(300U).toLimit(null))
        assertEquals(TorrentSeedStopLimit.Off, SeedStopChoice.Off.toLimit(125U))
        assertEquals(TorrentSeedStopLimit.UseGlobal, SeedStopChoice.UseGlobal.toLimit(null))
        assertEquals(
            TorrentSeedStopLimit.Limited(125U),
            SeedStopChoice.Custom.toLimit(parseSeedStopRatio("1.25")),
        )
        assertNull(SeedStopChoice.Custom.toLimit(parseSeedStopRatio("1.234")))
    }

    @Test
    fun customRatioParsesDecimalsIntoPercentWithinTheEngineBound() {
        assertEquals(200U, parseSeedStopRatio("2"))
        assertEquals(150U, parseSeedStopRatio("1.5"))
        assertEquals(125U, parseSeedStopRatio("1,25"))
        assertEquals(0U, parseSeedStopRatio("0"))
        assertEquals(SEED_STOP_LIMIT_MAX, parseSeedStopRatio("21474836.47"))
        assertNull(parseSeedStopRatio("21474836.48"))
        assertNull(parseSeedStopRatio("1.234"))
        assertNull(parseSeedStopRatio(""))
        assertNull(parseSeedStopRatio("."))
        assertNull(parseSeedStopRatio("2."))
        assertNull(parseSeedStopRatio("-1"))

        assertEquals("2.5", seedStopRatioText(250U))
        assertEquals("1.25", seedStopRatioText(125U))
        assertEquals("3", seedStopRatioText(300U))
        assertEquals("0", seedStopRatioText(0U))
        assertEquals("2", seedStopRatioText(null))
        assertEquals(125U, parseSeedStopRatio(seedStopRatioText(125U)))
    }

    @Test
    fun timePickerConvertsPresetsAndCustomUnitsToSeconds() {
        assertEquals(
            listOf(3_600U, 21_600U, 86_400U, 259_200U, 604_800U, 2_592_000U),
            SEED_STOP_TIME_PRESETS,
        )
        assertEquals(
            SeedStopChoice.Preset(604_800U),
            seedStopChoice(TorrentSeedStopLimit.Limited(604_800U), SEED_STOP_TIME_PRESETS),
        )
        assertEquals(
            SeedStopChoice.Custom,
            seedStopChoice(TorrentSeedStopLimit.Limited(7_200U), SEED_STOP_TIME_PRESETS),
        )

        assertEquals(259_200U, parseSeedStopTime("3", SeedTimeUnit.DAYS))
        assertEquals(7_200U, parseSeedStopTime("2", SeedTimeUnit.HOURS))
        assertEquals(2_700U, parseSeedStopTime("45", SeedTimeUnit.MINUTES))
        assertEquals(0U, parseSeedStopTime("0", SeedTimeUnit.MINUTES))
        assertEquals(2_147_483_640U, parseSeedStopTime("35791394", SeedTimeUnit.MINUTES))
        assertNull(parseSeedStopTime("24856", SeedTimeUnit.DAYS))
        assertNull(parseSeedStopTime("1.5", SeedTimeUnit.HOURS))
        assertNull(parseSeedStopTime("", SeedTimeUnit.HOURS))

        assertEquals("1" to SeedTimeUnit.DAYS, seedStopTimeText(86_400U))
        assertEquals("2" to SeedTimeUnit.HOURS, seedStopTimeText(7_200U))
        assertEquals("45" to SeedTimeUnit.MINUTES, seedStopTimeText(2_700U))
        // Seconds set elsewhere round to the nearest minute.
        assertEquals("2" to SeedTimeUnit.MINUTES, seedStopTimeText(90U))
        assertEquals("0" to SeedTimeUnit.MINUTES, seedStopTimeText(0U))
        assertEquals("1" to SeedTimeUnit.DAYS, seedStopTimeText(null))

        assertEquals(1L to SeedTimeAmountUnit.WEEKS, seedTimeAmount(604_800U))
        assertEquals(30L to SeedTimeAmountUnit.DAYS, seedTimeAmount(2_592_000U))
        assertEquals(6L to SeedTimeAmountUnit.HOURS, seedTimeAmount(21_600U))
        assertEquals(45L to SeedTimeAmountUnit.MINUTES, seedTimeAmount(2_700U))
    }

    @Test
    fun torrentLimitsResolveAgainstTheSessionLimit() {
        val global = SeedStopLimit.Limited(200U)
        assertEquals(global, effectiveSeedStopLimit(TorrentSeedStopLimit.UseGlobal, global))
        assertEquals(SeedStopLimit.Off, effectiveSeedStopLimit(TorrentSeedStopLimit.Off, global))
        assertEquals(
            SeedStopLimit.Limited(50U),
            effectiveSeedStopLimit(TorrentSeedStopLimit.Limited(50U), global),
        )
        assertNull(effectiveSeedStopLimit(TorrentSeedStopLimit.UseGlobal, null))
        assertEquals(TorrentSeedStopLimit.Off, SeedStopLimit.Off.asTorrentLimit())
        assertEquals(SeedStopLimit.Limited(7U), TorrentSeedStopLimit.Limited(7U).asSessionLimit())
        assertNull(TorrentSeedStopLimit.UseGlobal.asSessionLimit())
    }

    @Test
    fun clientDraftSendsOnlyChangedStopLimits() {
        val authority = settings(ratio = SeedStopLimit.Off, time = SeedStopLimit.Limited(86_400U))
        val values = authority.fieldValues()
        assertEquals(SeedStopLimit.Off, values[ClientSettingsField.SEED_STOP_RATIO])
        assertEquals(SeedStopLimit.Limited(86_400U), values[ClientSettingsField.SEED_STOP_TIME])

        var draft = SettingsDraftState<ClientSettingsField>().authority("client-settings", "4", values)
        val incoming =
            org.rstorrent.bootstrap.clientSettingsPatch(
                seedStopRatioPercent = SeedStopLimit.Limited(200U),
                seedStopTimeSeconds = SeedStopLimit.Limited(86_400U),
            ).fieldValues()
        draft = draft.edit(incoming)
        // The unchanged time limit matches authority, so only the ratio is pending.
        assertEquals(setOf(ClientSettingsField.SEED_STOP_RATIO), draft.overlays.keys)

        val patch = draft.overlays.toClientSettingsPatch()
        assertEquals(SeedStopLimit.Limited(200U), patch.seedStopRatioPercent)
        assertNull(patch.seedStopTimeSeconds)
        assertNull(patch.activeSeeds)
        assertNull(patch.shareRatioLimitPercent)
        assertNull(patch.uploadRateLimit)

        val turnedOff = mapOf<ClientSettingsField, Any>(ClientSettingsField.SEED_STOP_TIME to SeedStopLimit.Off)
        assertEquals(SeedStopLimit.Off, turnedOff.toClientSettingsPatch().seedStopTimeSeconds)
    }

    @Test
    fun torrentDraftCarriesStopOverridesAndPresentsThemBeforeTheEngineConfirms() {
        val plain = torrent("plain", operational = TorrentOperationalState.SEEDING)
        assertEquals(
            TorrentSeedStopLimits(TorrentSeedStopLimit.UseGlobal, TorrentSeedStopLimit.UseGlobal),
            plain.seedStopLimits(),
        )
        val values = plain.settingsFieldValues()
        assertEquals(TorrentSeedStopLimit.UseGlobal, values[TorrentSettingsField.SEED_STOP_RATIO])
        assertEquals(TransferRateLimit.Unlimited, values[TorrentSettingsField.UPLOAD_RATE_LIMIT])

        var draft = SettingsDraftState<TorrentSettingsField>().authority("plain", "3", values)
        draft = draft.edit(torrentSettingsPatch(seedStopTimeSeconds = TorrentSeedStopLimit.Off).fieldValues())
        assertEquals(setOf(TorrentSettingsField.SEED_STOP_TIME), draft.overlays.keys)
        val patch = draft.overlays.toTorrentSettingsPatch()
        assertEquals(TorrentSeedStopLimit.Off, patch.seedStopTimeSeconds)
        assertNull(patch.seedStopRatioPercent)
        assertNull(patch.uploadRateLimit)
        assertNull(patch.downloadRateLimit)

        val presented =
            ProductState(torrents = mapOf("plain" to plain), torrentSettingsDraft = draft)
                .presentedTorrent(plain)!!
        assertEquals(
            SeedStopView(
                TorrentSeedStopLimits(TorrentSeedStopLimit.UseGlobal, TorrentSeedStopLimit.Off),
                stopped = false,
            ),
            presented.seeding.stop,
        )

        // Returning both to Use global on a running torrent drops the stop view again.
        draft = draft.edit(mapOf(TorrentSettingsField.SEED_STOP_TIME to TorrentSeedStopLimit.UseGlobal))
        assertTrue(draft.overlays.isEmpty())
        assertNull(
            ProductState(torrentSettingsDraft = draft).presentedTorrent(plain)!!.seeding.stop,
        )

        // A limit-stopped torrent keeps its stopped flag while a draft is pending.
        val stopped = limitStopped("stopped")
        val stoppedDraft =
            SettingsDraftState<TorrentSettingsField>()
                .authority("stopped", "5", stopped.settingsFieldValues())
                .edit(mapOf(TorrentSettingsField.SEED_STOP_RATIO to TorrentSeedStopLimit.Limited(500U)))
        val stoppedView =
            ProductState(torrentSettingsDraft = stoppedDraft).presentedTorrent(stopped)!!.seeding.stop!!
        assertTrue(stoppedView.stopped)
        assertEquals(TorrentSeedStopLimit.Limited(500U), stoppedView.limits.ratioPercent)
    }

    @Test
    fun limitStoppedTorrentsReadSeedingLimitReachedAndOfferKeepSeeding() {
        val stopped = limitStopped("stopped")
        val paused =
            torrent("paused", operational = TorrentOperationalState.PAUSED).let {
                it.copy(progress = it.progress.copy(reason = ProgressReason.PAUSED))
            }
        val seeding = torrent("seeding", operational = TorrentOperationalState.SEEDING)

        assertTrue(stopped.stoppedBySeedLimit)
        assertEquals(R.string.state_seed_limit_reached, torrentStatusLabelRes(stopped))
        assertEquals(R.string.state_seed_limit_reached, torrentActivityLabelRes(stopped))
        assertEquals(R.string.action_keep_seeding, stopped.pauseResumeLabelRes())
        assertTrue(stopped.allows(TorrentAction.START))

        assertEquals(R.string.state_paused, torrentStatusLabelRes(paused))
        assertEquals(R.string.state_paused, torrentActivityLabelRes(paused))
        assertEquals(R.string.action_resume, paused.pauseResumeLabelRes())

        assertEquals(R.string.state_seeding, torrentStatusLabelRes(seeding))
        assertEquals(R.string.action_pause, seeding.pauseResumeLabelRes())

        // A torrent with its own limits but not stopped is an ordinary pause.
        val ownLimits =
            paused.copy(
                seeding =
                    paused.seeding.copy(
                        stop =
                            SeedStopView(
                                TorrentSeedStopLimits(TorrentSeedStopLimit.Limited(100U), TorrentSeedStopLimit.Off),
                                stopped = false,
                            ),
                    ),
            )
        assertEquals(R.string.state_paused, torrentStatusLabelRes(ownLimits))
        assertEquals(R.string.action_resume, ownLimits.pauseResumeLabelRes())

        // Archive and removal outrank the stop reason.
        assertEquals(R.string.state_archived, torrentStatusLabelRes(stopped.copy(archived = true)))
        // While the engine is still stopping, show Stopping.
        assertEquals(
            R.string.state_stopping,
            torrentStatusLabelRes(stopped.copy(operationalState = TorrentOperationalState.STOPPING)),
        )
    }

    @Test
    fun detailsProgressUsesTheEffectiveLimitsAndLifetimeCounters() {
        val global = settings(ratio = SeedStopLimit.Limited(200U), time = SeedStopLimit.Off)
        val seeding =
            torrent("seeding", operational = TorrentOperationalState.SEEDING)
                .copy(lifetime = TorrentLifetimeView("0", "0", "0", "64800", "70000", "142"))

        assertEquals(listOf(SeedStopProgress.Ratio(200U, "142")), seedStopProgress(seeding, global))
        assertNull(seedStopProgress(seeding, null))
        assertEquals(
            emptyList<SeedStopProgress>(),
            seedStopProgress(seeding, settings(ratio = SeedStopLimit.Off, time = SeedStopLimit.Off)),
        )

        val overridden =
            seeding.copy(
                seeding =
                    seeding.seeding.copy(
                        stop =
                            SeedStopView(
                                TorrentSeedStopLimits(
                                    TorrentSeedStopLimit.Off,
                                    TorrentSeedStopLimit.Limited(86_400U),
                                ),
                                stopped = false,
                            ),
                    ),
            )
        assertEquals(listOf(SeedStopProgress.Time(86_400U, "64800")), seedStopProgress(overridden, global))
        // Own limits on both resolve without session settings.
        assertEquals(listOf(SeedStopProgress.Time(86_400U, "64800")), seedStopProgress(overridden, null))
    }

    private fun limitStopped(id: String): TorrentView {
        val paused = torrent(id, operational = TorrentOperationalState.PAUSED)
        return paused.copy(
            seeding =
                paused.seeding.copy(
                    stop =
                        SeedStopView(
                            TorrentSeedStopLimits(TorrentSeedStopLimit.UseGlobal, TorrentSeedStopLimit.UseGlobal),
                            stopped = true,
                        ),
                ),
            progress = paused.progress.copy(reason = ProgressReason.PAUSED),
        )
    }

    private fun settings(
        ratio: SeedStopLimit,
        time: SeedStopLimit,
    ): ClientSettings =
        ClientSettings(
                            fileSafety = org.rstorrent.session.uniffi.FileSafetySettings(true, org.rstorrent.session.uniffi.FileSafetyPreset.RECOMMENDED, emptyList(), true),
            listener = ListenerPolicy.Disabled,
            preferredListenPort = 6_881U.toUShort(),
            portMapping = PortMappingPolicy.DISABLED,
            peerConnectionLimit = 200U,
            uploadSlots = 8U.toUShort(),
            activeDownloads = 3U.toUShort(),
            activeSeeds = ActiveSeedLimit.Unlimited,
            shareRatioLimitPercent = 200U,
            finishedDownloadRatioLimitPercent = 700U,
            finishedTimeLimitSeconds = 86_400U,
            seedStopRatioPercent = ratio,
            seedStopTimeSeconds = time,
            uploadRateLimit = TransferRateLimit.Unlimited,
            downloadRateLimit = TransferRateLimit.Unlimited,
            encryption = EncryptionPolicy.PREFER,
            ipv6Enabled = true,
            dhtEnabled = true,
            peerExchangeEnabled = true,
            trackerHttpsServerAuthentication = HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
        )

    private fun torrent(
        id: String,
        operational: TorrentOperationalState,
    ): TorrentView =
        TorrentView(
            safetySummary = null,
            torrentId = id,
            protocolIdentities = TorrentProtocolIdentities(v1 = null, v2 = null),
            displayName = id,
            sourceDisplayName = null,
            sourceSizeBytes = null,
            state = TorrentState.COMPLETE,
            operationalState = operational,
            downloadQueuePosition = null,
            transferLimits =
                TorrentTransferLimits(TransferRateLimit.Unlimited, TransferRateLimit.Unlimited),
            storageState = StorageState.AVAILABLE,
            storageRoot = "downloads",
            metadataAvailable = true,
            privateTorrent = false,
            awaitingFileSelection = false,
            pendingFileSelectionPosition = null,
            fileCatalogId = null,
            selectableFileCount = 0U,
            selectedFileCount = 0U,
            selectableFileBytes = "0",
            selectedFileBytes = "0",
            pieceCount = 10U,
            totalSizeBytes = "100",
            verifiedPieceCount = 10U,
            requestedBytes = "0",
            receivedBytes = "0",
            storedBytes = "0",
            activePeerConnections = 0U,
            configuredTrackerCount = 1U,
            payloadDownloadRateBytes = "0",
            requiredPayloadBytes = "100",
            remainingPayloadBytes = "0",
            etaPayloadDownloadRateBytes = "0",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", "0", "0", "0", "0", "0"),
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null, null),
            progress =
                ProgressAssessment(
                    ProgressDisposition.ACTIVE,
                    ProgressPhase.TRANSFER,
                    ProgressReason.COMPLETE,
                    emptyList(),
                ),
            checking = null,
            archived = false,
            removalState = null,
            deleteDataSupported = true,
            forceRecheckAvailable = true,
            error = null,
        )
}
