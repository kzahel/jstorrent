import Foundation
import RSTorrentIOS
import RSTorrentSession

struct RootDisplayItem: Identifiable, Equatable {
    var id: String
    var name: RootDisplayName
    var available: Bool
    var detail: RootDisplayDetail

    var label: String { name.text }
    var detailText: String { detail.text }
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var roots: [RootDisplayItem] = []
    @Published private(set) var engineStatus = EnginePresentationStatus.starting
    @Published private(set) var selectionStatus = SelectionPresentationStatus.noneSelected
    @Published private(set) var isBusy = false
    @Published var isFolderPickerPresented = false
    let presentation = IOSPresentationRepository()
    var userWorkDidStart: (() -> Void)?

    var isReady: Bool { client != nil }

    private let documentsURL: URL
    private let profileURL: URL
    private let rootStore: RootRegistryStore
    private var client: IosApplicationClient?
    private var storageBridge: PlatformStorageBridge?
    private var namespaceWork: Set<String> = []

    init(fileManager: FileManager = .default) {
        documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var support = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("RSTorrent", isDirectory: true)
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
            support.appendPathComponent("UITests", isDirectory: true)
        }
        profileURL = support.appendingPathComponent("profile", isDirectory: true)
        rootStore = RootRegistryStore(
            fileURL: support.appendingPathComponent("roots-v1.json", isDirectory: false)
        )
    }

    func start() async {
        guard client == nil else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try FileManager.default.createDirectory(
                at: documentsURL,
                withIntermediateDirectories: true
            )
            try FileManager.default.createDirectory(
                at: profileURL,
                withIntermediateDirectories: true
            )
            let document = try await rootStore.load()
            let restored = await restore(document.selectedRoots)
            let currentDocument = try await rootStore.load()
            let health = try await open(records: currentDocument.selectedRoots)
            let reconciled = reconcile(restored, with: health)
            roots = [
                RootDisplayItem(
                    id: "ios-documents",
                    name: .appDocuments,
                    available: true,
                    detail: .onMyDevice
                )
            ] + reconciled
            engineStatus = .ready
            if document.selectedRoots.isEmpty {
                selectionStatus = .noneSelected
            } else if reconciled.allSatisfy(\.available) {
                selectionStatus = .externalFoldersReady
            } else {
                selectionStatus = .folderNeedsRepair
            }
        } catch {
            engineStatus = .unavailable(error.localizedDescription)
        }
    }

    func selectFolder(_ url: URL) async {
        guard !isBusy else { return }
        isBusy = true
        selectionStatus = .checkingSelection
        defer { isBusy = false }
        do {
            let document = try await rootStore.load()
            let existingURLs = await resolvedURLs(document.selectedRoots)
            let documentsURL = documentsURL
            let qualified = try await Task.detached {
                try RootAccess.qualifySelection(
                    url,
                    registeredURLs: [documentsURL] + existingURLs
                )
            }.value
            let record = try await rootStore.install(
                bookmarkData: qualified.bookmarkData,
                displayLabel: qualified.displayLabel
            )
            try await restart()
            _ = try await dispatch(.setDefaultStorageRoot(storageRoot: record.id))
            selectionStatus = .folderReady(record.displayLabel)
        } catch {
            selectionStatus = .error(error.localizedDescription)
        }
    }

    func repairFolder(rootID: String, with url: URL) async {
        guard !isBusy else { return }
        guard rootID != "ios-documents" else {
            selectionStatus = .appFolderNeedsNoRepair
            return
        }
        isBusy = true
        selectionStatus = .checkingReplacement
        defer { isBusy = false }
        var restartTorrentIDs: [String] = []
        do {
            let document = try await rootStore.load()
            guard document.selectedRoots.contains(where: { $0.id == rootID }) else {
                throw AppModelError.unknownStorageRoot
            }
            let otherRecords = document.selectedRoots.filter { $0.id != rootID }
            let otherURLs = await resolvedURLs(otherRecords)
            let documentsURL = documentsURL
            let qualified = try await Task.detached {
                try RootAccess.qualifySelection(
                    url,
                    registeredURLs: [documentsURL] + otherURLs
                )
            }.value
            guard let client else { throw AppModelError.notReady }
            restartTorrentIDs = try await client.preparePlatformRootReplacement(rootId: rootID)
            let record = try await rootStore.replace(
                id: rootID,
                bookmarkData: qualified.bookmarkData,
                displayLabel: qualified.displayLabel
            )
            try await restart()
            for torrentID in restartTorrentIDs {
                _ = try await dispatch(.resume(torrentId: torrentID))
            }
            selectionStatus = .folderRepaired(record.displayLabel)
        } catch {
            if client != nil {
                for torrentID in restartTorrentIDs {
                    _ = try? await dispatch(.resume(torrentId: torrentID))
                }
            }
            selectionStatus = .error(error.localizedDescription)
        }
    }

    func shutdown() async throws {
        guard let client else { return }
        presentation.stop()
        try await client.shutdown()
        await storageBridge?.stopAfterClientShutdown()
        self.client = nil
        storageBridge = nil
        engineStatus = .stopped
    }

    func updateFileSafety(_ settings: FileSafetySettings, expected: FileSafetySettings) async throws {
        let current = try await dispatch(.snapshot)
        guard case .success(let snapshot) = current.outcome, snapshot.clientSettings.fileSafety == expected else {
            throw AppModelError.command(String(localized: "safety_conflict"))
        }
        _ = try await dispatch(.updateFileSafetySettings(settings: settings), expectedRevision: current.revision)
    }

    @discardableResult
    func dispatch(_ command: Command, expectedRevision: String? = nil) async throws -> ResponseEnvelope {
        guard let client else { throw AppModelError.notReady }
        let response = try await client.dispatch(
            request: RequestEnvelope(
                version: 1,
                requestId: "ios-\(UUID().uuidString.lowercased())",
                expectedRevision: expectedRevision,
                command: command
            )
        )
        if case .error(let error) = response.outcome {
            throw AppModelError.command(error.message)
        }
        switch command {
        case .addMagnet, .downloadFiles, .resume, .forceRecheck:
            userWorkDidStart?()
        default:
            break
        }
        return response
    }

    func addMagnet(_ magnet: String) async throws -> String {
        let root = presentation.storage?.defaultRoot ?? "ios-documents"
        let response = try await dispatch(
            .addMagnet(
                magnet: magnet,
                storageRoot: root,
                startContent: true,
                awaitFileSelection: false,
                skipFiles: []
            )
        )
        guard case .addTorrent(let result) = response.result else {
            throw AppModelError.missingAddResult
        }
        userWorkDidStart?()
        return result.torrentId
    }

    func addTorrentFile(_ url: URL) async throws -> String {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard !data.isEmpty, data.count <= 64 * 1024 * 1024 else {
            throw AppModelError.invalidTorrentLength(data.count)
        }
        guard let sourceLength = UInt32(exactly: data.count) else {
            throw AppModelError.invalidTorrentLength(data.count)
        }
        guard let client else { throw AppModelError.notReady }
        let response = try await client.addTorrentBytes(
            request: AddTorrentBytesRequest(
                version: 1,
                requestId: "ios-file-\(UUID().uuidString.lowercased())",
                expectedRevision: nil,
                storageRoot: presentation.storage?.defaultRoot ?? "ios-documents",
                startContent: true,
                awaitFileSelection: false,
                selection: .all,
                sourceLength: sourceLength
            ),
            source: data
        )
        if case .error(let error) = response.outcome {
            throw AppModelError.command(error.message)
        }
        guard case .addTorrent(let result) = response.result else {
            throw AppModelError.missingAddResult
        }
        return result.torrentId
    }

    func shareableFile(torrentID: String, fileIndex: UInt32) async throws -> ShareableFileLease {
        guard let client, let storageBridge else { throw AppModelError.notReady }
        let plan = try await client.filePlan(
            torrentId: torrentID,
            fileIndex: fileIndex
        )
        return try await Task.detached {
            try storageBridge.openShareableFile(plan)
        }.value
    }

    func resetExternalFolders() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let document = try await rootStore.load()
            _ = try await dispatch(.setDefaultStorageRoot(storageRoot: "ios-documents"))
            for root in document.selectedRoots {
                _ = try await dispatch(.removeStorageRoot(storageRoot: root.id))
                try await rootStore.remove(id: root.id)
            }
            try await restart()
            selectionStatus = .appFolderIsDefault
        } catch {
            selectionStatus = .error(error.localizedDescription)
        }
    }

    private func restart() async throws {
        if let client {
            presentation.stop()
            try await client.shutdown()
            await storageBridge?.stopAfterClientShutdown()
            self.client = nil
            storageBridge = nil
        }
        let document = try await rootStore.load()
        let restored = await restore(document.selectedRoots)
        let currentDocument = try await rootStore.load()
        let health = try await open(records: currentDocument.selectedRoots)
        roots = [
            RootDisplayItem(
                id: "ios-documents",
                name: .appDocuments,
                available: true,
                detail: .onMyDevice
            )
        ] + reconcile(restored, with: health)
    }

    private func open(records: [SelectedRootRecord]) async throws -> [String: Bool] {
        let roots = [
            IosStorageRootConfig(
                id: "ios-documents",
                label: String(localized: "ios_app_documents"),
                path: documentsURL.path
            )
        ] + records.map {
            IosStorageRootConfig(id: $0.id, label: $0.displayLabel, path: nil)
        }
        let opened = try await IosApplicationClient.open(
            config: IosApplicationConfig(
                profileRoot: profileURL.path,
                profileId: "ios",
                storageRoots: roots,
                networkPolicy: .online,
                peerConnectTimeoutSeconds: 10,
                peerIoTimeoutSeconds: 30
            )
        )
        let bridge = PlatformStorageBridge(
            client: opened,
            roots: records,
            appOwnedRoots: ["ios-documents": documentsURL]
        )
        bridge.start()
        client = opened
        storageBridge = bridge
        try await presentation.start(client: opened) { [weak self] torrents in
            guard let self else { return }
            Task { @MainActor in await self.advanceNamespaceTransitions(torrents) }
        }
        if !records.isEmpty {
            _ = try await opened.probePlatformStorageRoots()
        }
        let health = try await opened.storageRootHealth()
        return Dictionary(uniqueKeysWithValues: health.map { ($0.rootId, $0.available) })
    }

    private func reconcile(
        _ restored: [RootDisplayItem],
        with health: [String: Bool]
    ) -> [RootDisplayItem] {
        restored.map { root in
            guard root.available, health[root.id] == false else { return root }
            return RootDisplayItem(
                id: root.id,
                name: root.name,
                available: false,
                detail: .probeFailed
            )
        }
    }

    private func advanceNamespaceTransitions(_ torrents: [TorrentView]) async {
        guard let client, let storageBridge else { return }
        for torrent in torrents {
            guard torrent.removalState == .awaitingPlatform else { continue }
            let action = "remove"
            let key = "\(torrent.torrentId):\(action)"
            guard namespaceWork.insert(key).inserted else { continue }
            Task { @MainActor [weak self] in
                defer { self?.namespaceWork.remove(key) }
                guard let self else { return }
                do {
                    let plan = try await client.removalPlan(torrentId: torrent.torrentId)
                    do {
                        try await Task.detached {
                            try storageBridge.removeData(plan)
                        }.value
                        try await client.confirmRemoval(
                            torrentId: torrent.torrentId,
                            operationId: plan.operationId
                        )
                    } catch {
                        try? await client.failRemoval(
                            torrentId: torrent.torrentId,
                            operationId: plan.operationId,
                            message: String(error.localizedDescription.prefix(1_024))
                        )
                        throw error
                    }
                } catch {
                    self.presentationError(error)
                }
            }
        }
    }

    private func presentationError(_ error: Error) {
        selectionStatus = .error(error.localizedDescription)
    }

    func reportStatus(_ status: SelectionPresentationStatus) {
        selectionStatus = status
    }

    private func restore(_ records: [SelectedRootRecord]) async -> [RootDisplayItem] {
        var registered = [documentsURL]
        var displays: [RootDisplayItem] = []
        for record in records {
            do {
                let registeredURLs = registered
                let restored = try await Task.detached {
                    try RootAccess.restore(record, registeredURLs: registeredURLs)
                }.value
                registered.append(restored.coordinatedURL)
                if restored.stale {
                    _ = try await rootStore.replace(
                        id: record.id,
                        bookmarkData: restored.bookmarkData,
                        displayLabel: restored.displayLabel
                    )
                }
                displays.append(
                    RootDisplayItem(
                        id: record.id,
                        name: .supplied(restored.displayLabel),
                        available: true,
                        detail: .qualified
                    )
                )
            } catch {
                displays.append(
                    RootDisplayItem(
                        id: record.id,
                        name: .supplied(record.displayLabel),
                        available: false,
                        detail: .error(error.localizedDescription)
                    )
                )
            }
        }
        return displays
    }

    private func resolvedURLs(_ records: [SelectedRootRecord]) async -> [URL] {
        await Task.detached {
            records.compactMap { try? RootAccess.resolveBookmark($0.bookmarkData) }
        }.value
    }
}

enum AppModelError: Error, LocalizedError {
    case notReady
    case command(String)
    case missingAddResult
    case invalidTorrentLength(Int)
    case unknownStorageRoot

    var errorDescription: String? {
        switch self {
        case .notReady:
            return String(localized: "ios_error_not_ready")
        case .command(let message):
            return message
        case .missingAddResult:
            return String(localized: "ios_error_missing_add_result")
        case .invalidTorrentLength(let count):
            return String(
                format: String(localized: "ios_error_invalid_torrent_length"),
                locale: .current,
                count.formatted(.byteCount(style: .file))
            )
        case .unknownStorageRoot:
            return String(localized: "ios_error_unknown_storage_root")
        }
    }
}
