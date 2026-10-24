import RSTorrentSession
import XCTest

final class GeneratedSeedingContractTests: XCTestCase {
    func testCompleteClientSettingsRoundTripIncludesSeedingPolicy() throws {
        let settings = ClientSettings(
            fileSafety: FileSafetySettings(enabled: true, preset: .recommended, customExtensions: [], markInternetOrigin: true),
            listener: .automaticLocalNetwork,
            preferredListenPort: 6_881,
            portMapping: .upnp,
            peerConnectionLimit: 200,
            uploadSlots: 8,
            activeDownloads: 3,
            activeSeeds: .limited(torrents: 5),
            shareRatioLimitPercent: 200,
            finishedDownloadRatioLimitPercent: 700,
            finishedTimeLimitSeconds: 86_400,
            seedStopRatioPercent: .limited(value: 200),
            seedStopTimeSeconds: .off,
            uploadRateLimit: .unlimited,
            downloadRateLimit: .limited(bytesPerSecond: 1_048_576),
            encryption: .prefer,
            ipv6Enabled: true,
            dhtEnabled: false,
            peerExchangeEnabled: false,
            trackerHttpsServerAuthentication: .systemTrust
        )

        let roundTrip = try FfiConverterTypeClientSettings_lift(
            FfiConverterTypeClientSettings_lower(settings)
        )

        XCTAssertEqual(roundTrip, settings)
    }

    func testSparseClientSettingsPatchRoundTripsUnlimitedSeedsAndGoalEdges() throws {
        let patch = ClientSettingsPatch(
            listener: nil,
            preferredListenPort: nil,
            portMapping: nil,
            peerConnectionLimit: nil,
            uploadSlots: nil,
            activeDownloads: nil,
            activeSeeds: .unlimited,
            shareRatioLimitPercent: 0,
            finishedDownloadRatioLimitPercent: UInt32(Int32.max),
            finishedTimeLimitSeconds: UInt32(Int32.max),
            seedStopRatioPercent: .off,
            seedStopTimeSeconds: .limited(value: UInt32(Int32.max)),
            uploadRateLimit: nil,
            downloadRateLimit: nil,
            encryption: nil,
            ipv6Enabled: nil,
            dhtEnabled: false,
            peerExchangeEnabled: true,
            trackerHttpsServerAuthentication: nil
        )

        let roundTrip = try FfiConverterTypeClientSettingsPatch_lift(
            FfiConverterTypeClientSettingsPatch_lower(patch)
        )

        XCTAssertEqual(roundTrip, patch)
    }
}
