package org.rstorrent.bootstrap

import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.SeedStopLimit
import org.rstorrent.session.uniffi.SeedStopView
import org.rstorrent.session.uniffi.TorrentSeedStopLimit
import org.rstorrent.session.uniffi.TorrentSeedStopLimits
import org.rstorrent.session.uniffi.TorrentSettingsPatch
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit

enum class ClientSettingsField {
    LISTENER,
    PREFERRED_LISTEN_PORT,
    PORT_MAPPING,
    PEER_CONNECTION_LIMIT,
    UPLOAD_SLOTS,
    ACTIVE_DOWNLOADS,
    ACTIVE_SEEDS,
    SHARE_RATIO_LIMIT,
    FINISHED_DOWNLOAD_RATIO_LIMIT,
    FINISHED_TIME_LIMIT,
    SEED_STOP_RATIO,
    SEED_STOP_TIME,
    UPLOAD_RATE_LIMIT,
    DOWNLOAD_RATE_LIMIT,
    ENCRYPTION,
    IPV6_ENABLED,
    DHT_ENABLED,
    PEER_EXCHANGE_ENABLED,
    TRACKER_HTTPS_AUTHENTICATION,
}

enum class TorrentSettingsField {
    UPLOAD_RATE_LIMIT,
    DOWNLOAD_RATE_LIMIT,
    SEED_STOP_RATIO,
    SEED_STOP_TIME,
}

data class SettingsDraftSubmission<K : Any>(
    val values: Map<K, Any>,
    val editSerials: Map<K, Long>,
    val awaiting: Set<K>,
    val acceptedRevision: String? = null,
)

internal data class SettingsDraftRequest<K : Any>(
    val resourceKey: String,
    val expectedRevision: String,
    val values: Map<K, Any>,
)

internal data class SettingsDraftDispatch<K : Any>(
    val draft: SettingsDraftState<K>,
    val request: SettingsDraftRequest<K>?,
)

data class SettingsDraftState<K : Any>(
    val resourceKey: String? = null,
    val authorityRevision: String? = null,
    val authority: Map<K, Any> = emptyMap(),
    val overlays: Map<K, Any> = emptyMap(),
    val editBases: Map<K, Any> = emptyMap(),
    val editSerials: Map<K, Long> = emptyMap(),
    val submission: SettingsDraftSubmission<K>? = null,
    val conflicts: Set<K> = emptySet(),
    val failure: String? = null,
    val nextEditSerial: Long = 1L,
) {
    fun authority(
        key: String,
        revision: String,
        values: Map<K, Any>,
    ): SettingsDraftState<K> {
        if (!isCanonicalRevision(revision)) {
            return copy(failure = "Authoritative settings revision is invalid.")
        }
        if (resourceKey != key) {
            return SettingsDraftState(
                resourceKey = key,
                authorityRevision = revision,
                authority = values,
            )
        }
        if (
            authorityRevision != null &&
                compareRevisions(revision, authorityRevision) < 0
        ) {
            return this
        }
        if (revision == authorityRevision && values == authority) return this
        return applyAuthority(revision, values)
    }

    fun edit(changes: Map<K, Any>): SettingsDraftState<K> {
        if (resourceKey == null) return this
        val nextOverlays = overlays.toMutableMap()
        val nextBases = editBases.toMutableMap()
        val nextSerials = editSerials.toMutableMap()
        val nextConflicts = conflicts.toMutableSet()
        var serial = nextEditSerial
        changes.forEach { (field, value) ->
            nextConflicts.remove(field)
            val submitted = submission?.values?.get(field)
            val protectsNewerEdit = submitted != null && submitted != value
            if (authority[field] == value && !protectsNewerEdit) {
                nextOverlays.remove(field)
                nextBases.remove(field)
                nextSerials.remove(field)
                nextConflicts.remove(field)
            } else {
                if (!nextOverlays.containsKey(field)) {
                    authority[field]?.let { nextBases[field] = it }
                }
                nextOverlays[field] = value
                nextSerials[field] = serial++
            }
        }
        return copy(
            overlays = nextOverlays,
            editBases = nextBases,
            editSerials = nextSerials,
            conflicts = nextConflicts,
            failure = null,
            nextEditSerial = serial,
        )
    }

    fun beginSubmit(): SettingsDraftState<K> {
        if (submission != null || overlays.isEmpty() || failure != null || conflicts.isNotEmpty()) {
            return this
        }
        return copy(
            submission =
                SettingsDraftSubmission(
                    values = overlays.toMap(),
                    editSerials = editSerials.toMap(),
                    awaiting = overlays.keys.toSet(),
                ),
        )
    }

    fun accepted(
        key: String,
        revision: String,
    ): SettingsDraftState<K> {
        val captured = submission ?: return this
        if (resourceKey != key) return this
        if (!isCanonicalRevision(revision)) {
            return copy(submission = null, failure = "Settings receipt revision is invalid.")
        }
        return copy(
            submission = captured.copy(acceptedRevision = revision),
            failure = null,
        ).applyAuthority(authorityRevision ?: revision, authority)
    }

    fun failed(
        key: String,
        message: String,
    ): SettingsDraftState<K> =
        if (resourceKey != key) {
            this
        } else {
            copy(
                submission = null,
                failure = (message.trim().ifEmpty { "Settings update failed." }).take(512),
            )
        }

    fun discard(): SettingsDraftState<K> =
        if (resourceKey == null || authorityRevision == null) {
            SettingsDraftState()
        } else {
            SettingsDraftState(
                resourceKey = resourceKey,
                authorityRevision = authorityRevision,
                authority = authority,
            )
        }

    fun materialized(): Map<K, Any> = authority + overlays

    private fun applyAuthority(
        revision: String,
        values: Map<K, Any>,
    ): SettingsDraftState<K> {
        val nextOverlays = overlays.toMutableMap()
        val nextBases = editBases.toMutableMap()
        val nextSerials = editSerials.toMutableMap()
        val nextConflicts = conflicts.toMutableSet()
        val captured = submission
        val awaiting = captured?.awaiting?.toMutableSet() ?: mutableSetOf()
        val sufficientlyNew =
            captured?.acceptedRevision?.let { compareRevisions(revision, it) >= 0 } == true

        values.forEach { (field, authoritative) ->
            if (!nextOverlays.containsKey(field)) return@forEach
            val submitted = captured?.values?.get(field)
            if (sufficientlyNew && field in awaiting && submitted == authoritative) {
                awaiting.remove(field)
                if (
                    captured.editSerials[field] == nextSerials[field] &&
                        nextOverlays[field] == submitted
                ) {
                    nextOverlays.remove(field)
                    nextBases.remove(field)
                    nextSerials.remove(field)
                } else {
                    nextBases[field] = authoritative
                }
                nextConflicts.remove(field)
            } else if (sufficientlyNew && field in awaiting) {
                awaiting.remove(field)
                nextConflicts.add(field)
            } else if (nextBases[field] != authoritative) {
                nextConflicts.add(field)
            }
        }
        return copy(
            authorityRevision = revision,
            authority = values,
            overlays = nextOverlays,
            editBases = nextBases,
            editSerials = nextSerials,
            submission =
                captured?.let {
                    if (awaiting.isEmpty()) null else it.copy(awaiting = awaiting)
                },
            conflicts = nextConflicts,
        )
    }
}

internal fun <K : Any> captureSettingsDraftRequest(
    current: SettingsDraftState<K>,
): SettingsDraftDispatch<K> {
    val prepared =
        if (current.submission == null &&
            current.failure == null &&
            current.conflicts.isEmpty()
        ) {
            current.beginSubmit()
        } else {
            current
        }
    val submission = prepared.submission
    val key = prepared.resourceKey
    val revision = prepared.authorityRevision
    val request =
        if (submission != null &&
            submission.acceptedRevision == null &&
            key != null &&
            revision != null
        ) {
            SettingsDraftRequest(key, revision, submission.values)
        } else {
            null
        }
    return SettingsDraftDispatch(prepared, request)
}

internal fun <K : Any> SettingsDraftState<K>.hasDispatchableSettingsDraft(): Boolean =
    submission == null && overlays.isNotEmpty() && failure == null && conflicts.isEmpty()

internal fun ClientSettings.fieldValues(): Map<ClientSettingsField, Any> =
    mapOf(
        ClientSettingsField.LISTENER to listener,
        ClientSettingsField.PREFERRED_LISTEN_PORT to preferredListenPort,
        ClientSettingsField.PORT_MAPPING to portMapping,
        ClientSettingsField.PEER_CONNECTION_LIMIT to peerConnectionLimit,
        ClientSettingsField.UPLOAD_SLOTS to uploadSlots,
        ClientSettingsField.ACTIVE_DOWNLOADS to activeDownloads,
        ClientSettingsField.ACTIVE_SEEDS to activeSeeds,
        ClientSettingsField.SHARE_RATIO_LIMIT to shareRatioLimitPercent,
        ClientSettingsField.FINISHED_DOWNLOAD_RATIO_LIMIT to finishedDownloadRatioLimitPercent,
        ClientSettingsField.FINISHED_TIME_LIMIT to finishedTimeLimitSeconds,
        ClientSettingsField.SEED_STOP_RATIO to seedStopRatioPercent,
        ClientSettingsField.SEED_STOP_TIME to seedStopTimeSeconds,
        ClientSettingsField.UPLOAD_RATE_LIMIT to uploadRateLimit,
        ClientSettingsField.DOWNLOAD_RATE_LIMIT to downloadRateLimit,
        ClientSettingsField.ENCRYPTION to encryption,
        ClientSettingsField.IPV6_ENABLED to ipv6Enabled,
        ClientSettingsField.DHT_ENABLED to dhtEnabled,
        ClientSettingsField.PEER_EXCHANGE_ENABLED to peerExchangeEnabled,
        ClientSettingsField.TRACKER_HTTPS_AUTHENTICATION to trackerHttpsServerAuthentication,
    )

internal fun ClientSettingsPatch.fieldValues(): Map<ClientSettingsField, Any> =
    buildMap {
        listener?.let { put(ClientSettingsField.LISTENER, it) }
        preferredListenPort?.let { put(ClientSettingsField.PREFERRED_LISTEN_PORT, it) }
        portMapping?.let { put(ClientSettingsField.PORT_MAPPING, it) }
        peerConnectionLimit?.let { put(ClientSettingsField.PEER_CONNECTION_LIMIT, it) }
        uploadSlots?.let { put(ClientSettingsField.UPLOAD_SLOTS, it) }
        activeDownloads?.let { put(ClientSettingsField.ACTIVE_DOWNLOADS, it) }
        activeSeeds?.let { put(ClientSettingsField.ACTIVE_SEEDS, it) }
        shareRatioLimitPercent?.let { put(ClientSettingsField.SHARE_RATIO_LIMIT, it) }
        finishedDownloadRatioLimitPercent?.let {
            put(ClientSettingsField.FINISHED_DOWNLOAD_RATIO_LIMIT, it)
        }
        finishedTimeLimitSeconds?.let { put(ClientSettingsField.FINISHED_TIME_LIMIT, it) }
        seedStopRatioPercent?.let { put(ClientSettingsField.SEED_STOP_RATIO, it) }
        seedStopTimeSeconds?.let { put(ClientSettingsField.SEED_STOP_TIME, it) }
        uploadRateLimit?.let { put(ClientSettingsField.UPLOAD_RATE_LIMIT, it) }
        downloadRateLimit?.let { put(ClientSettingsField.DOWNLOAD_RATE_LIMIT, it) }
        encryption?.let { put(ClientSettingsField.ENCRYPTION, it) }
        ipv6Enabled?.let { put(ClientSettingsField.IPV6_ENABLED, it) }
        dhtEnabled?.let { put(ClientSettingsField.DHT_ENABLED, it) }
        peerExchangeEnabled?.let { put(ClientSettingsField.PEER_EXCHANGE_ENABLED, it) }
        trackerHttpsServerAuthentication?.let {
            put(ClientSettingsField.TRACKER_HTTPS_AUTHENTICATION, it)
        }
    }

internal fun Map<ClientSettingsField, Any>.toClientSettingsPatch(): ClientSettingsPatch =
    clientSettingsPatch(
        listener = get(ClientSettingsField.LISTENER) as? ListenerPolicy,
        preferredListenPort = get(ClientSettingsField.PREFERRED_LISTEN_PORT) as? UShort,
        portMapping = get(ClientSettingsField.PORT_MAPPING) as? PortMappingPolicy,
        peerConnectionLimit = get(ClientSettingsField.PEER_CONNECTION_LIMIT) as? UInt,
        uploadSlots = get(ClientSettingsField.UPLOAD_SLOTS) as? UShort,
        activeDownloads = get(ClientSettingsField.ACTIVE_DOWNLOADS) as? UShort,
        activeSeeds = get(ClientSettingsField.ACTIVE_SEEDS) as? ActiveSeedLimit,
        shareRatioLimitPercent = get(ClientSettingsField.SHARE_RATIO_LIMIT) as? UInt,
        finishedDownloadRatioLimitPercent =
            get(ClientSettingsField.FINISHED_DOWNLOAD_RATIO_LIMIT) as? UInt,
        finishedTimeLimitSeconds = get(ClientSettingsField.FINISHED_TIME_LIMIT) as? UInt,
        seedStopRatioPercent = get(ClientSettingsField.SEED_STOP_RATIO) as? SeedStopLimit,
        seedStopTimeSeconds = get(ClientSettingsField.SEED_STOP_TIME) as? SeedStopLimit,
        uploadRateLimit = get(ClientSettingsField.UPLOAD_RATE_LIMIT) as? TransferRateLimit,
        downloadRateLimit = get(ClientSettingsField.DOWNLOAD_RATE_LIMIT) as? TransferRateLimit,
        encryption = get(ClientSettingsField.ENCRYPTION) as? EncryptionPolicy,
        ipv6Enabled = get(ClientSettingsField.IPV6_ENABLED) as? Boolean,
        dhtEnabled = get(ClientSettingsField.DHT_ENABLED) as? Boolean,
        peerExchangeEnabled = get(ClientSettingsField.PEER_EXCHANGE_ENABLED) as? Boolean,
        trackerHttpsServerAuthentication =
            get(ClientSettingsField.TRACKER_HTTPS_AUTHENTICATION)
                as? HttpsServerAuthenticationPolicy,
    )

/** A torrent's own stop limits; an absent stop view means both follow the session. */
internal fun TorrentView.seedStopLimits(): TorrentSeedStopLimits =
    seeding.stop?.limits
        ?: TorrentSeedStopLimits(TorrentSeedStopLimit.UseGlobal, TorrentSeedStopLimit.UseGlobal)

internal fun TorrentView.settingsFieldValues(): Map<TorrentSettingsField, Any> {
    val stop = seedStopLimits()
    return mapOf(
        TorrentSettingsField.UPLOAD_RATE_LIMIT to transferLimits.upload,
        TorrentSettingsField.DOWNLOAD_RATE_LIMIT to transferLimits.download,
        TorrentSettingsField.SEED_STOP_RATIO to stop.ratioPercent,
        TorrentSettingsField.SEED_STOP_TIME to stop.timeSeconds,
    )
}

internal fun TorrentSettingsPatch.fieldValues(): Map<TorrentSettingsField, Any> =
    buildMap {
        uploadRateLimit?.let { put(TorrentSettingsField.UPLOAD_RATE_LIMIT, it) }
        downloadRateLimit?.let { put(TorrentSettingsField.DOWNLOAD_RATE_LIMIT, it) }
        seedStopRatioPercent?.let { put(TorrentSettingsField.SEED_STOP_RATIO, it) }
        seedStopTimeSeconds?.let { put(TorrentSettingsField.SEED_STOP_TIME, it) }
    }

internal fun Map<TorrentSettingsField, Any>.toTorrentSettingsPatch(): TorrentSettingsPatch =
    torrentSettingsPatch(
        uploadRateLimit = get(TorrentSettingsField.UPLOAD_RATE_LIMIT) as? TransferRateLimit,
        downloadRateLimit = get(TorrentSettingsField.DOWNLOAD_RATE_LIMIT) as? TransferRateLimit,
        seedStopRatioPercent = get(TorrentSettingsField.SEED_STOP_RATIO) as? TorrentSeedStopLimit,
        seedStopTimeSeconds = get(TorrentSettingsField.SEED_STOP_TIME) as? TorrentSeedStopLimit,
    )

internal fun ProductState.presentedClientSettings(): ClientSettingsRuntimeView? {
    val runtime = clientSettings ?: return null
    val values = clientSettingsDraft.materialized()
    if (clientSettingsDraft.resourceKey == null) return runtime
    return runtime.copy(
        configured =
            runtime.configured.copy(
                listener = values[ClientSettingsField.LISTENER] as ListenerPolicy,
                preferredListenPort =
                    values[ClientSettingsField.PREFERRED_LISTEN_PORT] as UShort,
                portMapping = values[ClientSettingsField.PORT_MAPPING] as PortMappingPolicy,
                peerConnectionLimit =
                    values[ClientSettingsField.PEER_CONNECTION_LIMIT] as UInt,
                uploadSlots = values[ClientSettingsField.UPLOAD_SLOTS] as UShort,
                activeDownloads = values[ClientSettingsField.ACTIVE_DOWNLOADS] as UShort,
                activeSeeds = values[ClientSettingsField.ACTIVE_SEEDS] as ActiveSeedLimit,
                shareRatioLimitPercent = values[ClientSettingsField.SHARE_RATIO_LIMIT] as UInt,
                finishedDownloadRatioLimitPercent =
                    values[ClientSettingsField.FINISHED_DOWNLOAD_RATIO_LIMIT] as UInt,
                finishedTimeLimitSeconds = values[ClientSettingsField.FINISHED_TIME_LIMIT] as UInt,
                seedStopRatioPercent = values[ClientSettingsField.SEED_STOP_RATIO] as SeedStopLimit,
                seedStopTimeSeconds = values[ClientSettingsField.SEED_STOP_TIME] as SeedStopLimit,
                uploadRateLimit =
                    values[ClientSettingsField.UPLOAD_RATE_LIMIT] as TransferRateLimit,
                downloadRateLimit =
                    values[ClientSettingsField.DOWNLOAD_RATE_LIMIT] as TransferRateLimit,
                encryption = values[ClientSettingsField.ENCRYPTION] as EncryptionPolicy,
                ipv6Enabled = values[ClientSettingsField.IPV6_ENABLED] as Boolean,
                dhtEnabled = values[ClientSettingsField.DHT_ENABLED] as Boolean,
                peerExchangeEnabled =
                    values[ClientSettingsField.PEER_EXCHANGE_ENABLED] as Boolean,
                trackerHttpsServerAuthentication =
                    values[ClientSettingsField.TRACKER_HTTPS_AUTHENTICATION]
                        as HttpsServerAuthenticationPolicy,
            ),
    )
}

internal fun ProductState.presentedTorrent(torrent: TorrentView?): TorrentView? {
    torrent ?: return null
    if (torrentSettingsDraft.resourceKey != torrent.torrentId) return torrent
    val values = torrentSettingsDraft.materialized()
    val ratio = values[TorrentSettingsField.SEED_STOP_RATIO] as TorrentSeedStopLimit
    val time = values[TorrentSettingsField.SEED_STOP_TIME] as TorrentSeedStopLimit
    val stopped = torrent.seeding.stop?.stopped == true
    val stop =
        if (
            ratio == TorrentSeedStopLimit.UseGlobal &&
                time == TorrentSeedStopLimit.UseGlobal &&
                !stopped
        ) {
            null
        } else {
            SeedStopView(TorrentSeedStopLimits(ratio, time), stopped)
        }
    return torrent.copy(
        transferLimits =
            torrent.transferLimits.copy(
                upload =
                    values[TorrentSettingsField.UPLOAD_RATE_LIMIT] as TransferRateLimit,
                download =
                    values[TorrentSettingsField.DOWNLOAD_RATE_LIMIT] as TransferRateLimit,
            ),
        seeding = torrent.seeding.copy(stop = stop),
    )
}

internal fun ProductState.latestDurableRevision(): String =
    streams.values
        .map(StreamPosition::revision)
        .maxWithOrNull(::compareSettingsRevisions)
        ?: "0"

internal fun compareSettingsRevisions(left: String, right: String): Int {
    require(isCanonicalRevision(left) && isCanonicalRevision(right))
    if (left.length != right.length) return left.length.compareTo(right.length)
    return left.compareTo(right)
}

private fun compareRevisions(left: String, right: String): Int =
    compareSettingsRevisions(left, right)

private fun isCanonicalRevision(value: String): Boolean =
    value == "0" || Regex("^[1-9][0-9]*$").matches(value)
