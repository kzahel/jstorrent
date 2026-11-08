package org.rstorrent.bootstrap

import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.SeedStopLimit
import org.rstorrent.session.uniffi.TorrentSeedStopLimit
import org.rstorrent.session.uniffi.TorrentSettingsPatch
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TransferRateLimit

internal fun clientSettingsPatch(
    listener: ListenerPolicy? = null,
    preferredListenPort: UShort? = null,
    portMapping: PortMappingPolicy? = null,
    peerConnectionLimit: UInt? = null,
    uploadSlots: UShort? = null,
    activeDownloads: UShort? = null,
    activeSeeds: ActiveSeedLimit? = null,
    shareRatioLimitPercent: UInt? = null,
    finishedDownloadRatioLimitPercent: UInt? = null,
    finishedTimeLimitSeconds: UInt? = null,
    seedStopRatioPercent: SeedStopLimit? = null,
    seedStopTimeSeconds: SeedStopLimit? = null,
    uploadRateLimit: TransferRateLimit? = null,
    downloadRateLimit: TransferRateLimit? = null,
    encryption: EncryptionPolicy? = null,
    ipv6Enabled: Boolean? = null,
    dhtEnabled: Boolean? = null,
    peerExchangeEnabled: Boolean? = null,
    trackerHttpsServerAuthentication: HttpsServerAuthenticationPolicy? = null,
): ClientSettingsPatch =
    ClientSettingsPatch(
        listener = listener,
        preferredListenPort = preferredListenPort,
        portMapping = portMapping,
        peerConnectionLimit = peerConnectionLimit,
        uploadSlots = uploadSlots,
        activeDownloads = activeDownloads,
        activeSeeds = activeSeeds,
        shareRatioLimitPercent = shareRatioLimitPercent,
        finishedDownloadRatioLimitPercent = finishedDownloadRatioLimitPercent,
        finishedTimeLimitSeconds = finishedTimeLimitSeconds,
        seedStopRatioPercent = seedStopRatioPercent,
        seedStopTimeSeconds = seedStopTimeSeconds,
        uploadRateLimit = uploadRateLimit,
        downloadRateLimit = downloadRateLimit,
        encryption = encryption,
        ipv6Enabled = ipv6Enabled,
        dhtEnabled = dhtEnabled,
        peerExchangeEnabled = peerExchangeEnabled,
        trackerHttpsServerAuthentication = trackerHttpsServerAuthentication,
    )

internal fun ClientSettings.asPatch(): ClientSettingsPatch =
    clientSettingsPatch(
        listener = listener,
        preferredListenPort = preferredListenPort,
        portMapping = portMapping,
        peerConnectionLimit = peerConnectionLimit,
        uploadSlots = uploadSlots,
        activeDownloads = activeDownloads,
        activeSeeds = activeSeeds,
        shareRatioLimitPercent = shareRatioLimitPercent,
        finishedDownloadRatioLimitPercent = finishedDownloadRatioLimitPercent,
        finishedTimeLimitSeconds = finishedTimeLimitSeconds,
        seedStopRatioPercent = seedStopRatioPercent,
        seedStopTimeSeconds = seedStopTimeSeconds,
        uploadRateLimit = uploadRateLimit,
        downloadRateLimit = downloadRateLimit,
        encryption = encryption,
        ipv6Enabled = ipv6Enabled,
        dhtEnabled = dhtEnabled,
        peerExchangeEnabled = peerExchangeEnabled,
        trackerHttpsServerAuthentication = trackerHttpsServerAuthentication,
    )

internal fun torrentSettingsPatch(
    uploadRateLimit: TransferRateLimit? = null,
    downloadRateLimit: TransferRateLimit? = null,
    seedStopRatioPercent: TorrentSeedStopLimit? = null,
    seedStopTimeSeconds: TorrentSeedStopLimit? = null,
): TorrentSettingsPatch =
    TorrentSettingsPatch(
        uploadRateLimit = uploadRateLimit,
        downloadRateLimit = downloadRateLimit,
        seedStopRatioPercent = seedStopRatioPercent,
        seedStopTimeSeconds = seedStopTimeSeconds,
    )

internal fun TorrentTransferLimits.asPatch(): TorrentSettingsPatch =
    torrentSettingsPatch(upload, download)
