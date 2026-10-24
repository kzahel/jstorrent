import Foundation
import RSTorrentIOS
import RSTorrentSession

struct IOSStreamPosition: Equatable {
    var epoch: String
    var sequence: UInt64
    var revision: String
}

struct IOSPieceActivity: Equatable {
    var pieceCount: UInt32
    var verified: [IndexRange]
    var active: [ActivePiece]
}

enum IOSPresentationError: Error, LocalizedError {
    case unsupportedContract(UInt16)
    case invalidSequence
    case discontinuity

    var errorDescription: String? {
        switch self {
        case .unsupportedContract(let version):
            return "Unsupported application view contract \(version)."
        case .invalidSequence:
            return "The application view returned an invalid sequence."
        case .discontinuity:
            return "The application view needs a fresh snapshot."
        }
    }
}

@MainActor
final class IOSPresentationRepository: ObservableObject {
    @Published private(set) var torrents: [TorrentView] = []
    @Published private(set) var preparations: [String: TorrentPreparationView] = [:]
    @Published private(set) var fileSafetySettings: FileSafetySettings?
    @Published private(set) var storage: StorageSettingsSnapshot?
    @Published private(set) var error: String?
    @Published private(set) var files: [String: [FileView]] = [:]
    @Published private(set) var media: [String: [MediaItemView]] = [:]
    @Published private(set) var trackers: [String: [TrackerView]] = [:]
    @Published private(set) var peers: [String: [PeerView]] = [:]
    @Published private(set) var pieces: [String: IOSPieceActivity] = [:]
    @Published private(set) var currentRates: SessionCurrentRatesView?
    @Published private(set) var speed: SpeedHistoryView?

    private var positions: [String: IOSStreamPosition] = [:]
    private var task: Task<Void, Never>?
    private var subscription: IosViewSubscription?
    private var detailTask: Task<Void, Never>?
    private var detailSubscription: IosViewSubscription?
    private var onProductUpdate: (([TorrentView]) -> Void)?
    private var currentClient: IosApplicationClient?

    func start(
        client: IosApplicationClient,
        onProductUpdate: @escaping ([TorrentView]) -> Void
    ) async throws {
        stop()
        currentClient = client
        self.onProductUpdate = onProductUpdate
        let subscription = try await client.subscribe(
            spec: SubscriptionSpec(
                selector: .torrentList,
                projection: .summary,
                delivery: DeliveryPolicy(
                    minIntervalMillis: 250,
                    maxQueueBytes: 256 * 1024
                ),
                diagnostics: nil,
                catalogPage: nil
            )
        )
        self.subscription = subscription
        task = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, let update = await subscription.nextUpdate() {
                do {
                    try apply(update)
                } catch IOSPresentationError.discontinuity {
                    do {
                        try subscription.resync()
                    } catch {
                        self.error = error.localizedDescription
                    }
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        subscription = nil
        detailTask?.cancel()
        detailTask = nil
        detailSubscription = nil
        positions.removeAll()
        onProductUpdate = nil
        currentClient = nil
    }

    func present(torrentID: String, projection: ViewProjection) async {
        detailTask?.cancel()
        detailTask = nil
        detailSubscription = nil
        guard projection != .summary, let client = currentClient else { return }
        do {
            let paged = projection == .files || projection == .trackers
            let detail = try await client.subscribe(
                spec: SubscriptionSpec(
                    selector: .torrent(torrentId: torrentID),
                    projection: projection,
                    delivery: DeliveryPolicy(
                        minIntervalMillis: projection == .pieceActivity ? 100 : 250,
                        maxQueueBytes: 512 * 1024
                    ),
                    diagnostics: nil,
                    catalogPage: paged ? CatalogPageRequest(offset: 0, limit: 1_024) : nil
                )
            )
            detailSubscription = detail
            detailTask = Task { [weak self] in
                guard let self else { return }
                while !Task.isCancelled, let update = await detail.nextUpdate() {
                    do {
                        try apply(update)
                    } catch IOSPresentationError.discontinuity {
                        try? detail.resync()
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearDetail() {
        detailTask?.cancel()
        detailTask = nil
        detailSubscription = nil
    }

    func apply(_ update: ViewUpdate) throws {
        guard update.contractVersion == 2 else {
            throw IOSPresentationError.unsupportedContract(update.contractVersion)
        }
        guard let sequence = UInt64(update.sequence) else {
            throw IOSPresentationError.invalidSequence
        }
        switch update.payload {
        case .resetRequired:
            throw IOSPresentationError.discontinuity
        case .snapshot(let snapshot):
            positions[update.streamId] = IOSStreamPosition(
                epoch: update.epoch,
                sequence: sequence,
                revision: update.revision
            )
            applySnapshot(snapshot)
        case .patch(let patch):
            guard
                let current = positions[update.streamId],
                current.epoch == update.epoch,
                current.sequence < UInt64.max,
                current.sequence + 1 == sequence,
                current.revision == update.baseRevision
            else {
                throw IOSPresentationError.discontinuity
            }
            positions[update.streamId] = IOSStreamPosition(
                epoch: update.epoch,
                sequence: sequence,
                revision: update.revision
            )
            try applyPatch(patch)
        }
        error = nil
    }

    private func applySnapshot(_ snapshot: ViewSnapshot) {
        switch snapshot {
        case .torrentList(let torrents, let storage, let settings):
            self.torrents = Self.sorted(torrents)
            self.storage = storage
            self.fileSafetySettings = settings.configured.fileSafety
            onProductUpdate?(self.torrents)
        case .torrent(let torrent):
            guard let torrent else { return }
            replaceTorrent(torrent)
        case .torrentPreparation(let torrentID, let preparation):
            preparations[torrentID] = preparation
        case .files(let torrentID, _, _, _, let files):
            self.files[torrentID] = files.sorted { $0.fileIndex < $1.fileIndex }
        case .media(let torrentID, _, _, let items):
            media[torrentID] = items.sorted { $0.fileIndex < $1.fileIndex }
        case .trackers(let torrentID, _, _, let trackers):
            self.trackers[torrentID] = trackers.sorted(by: Self.trackerOrder)
        case .peers(let torrentID, let peers):
            self.peers[torrentID] = peers.sorted { $0.connectionId < $1.connectionId }
        case .pieceActivity(let torrentID, let count, let verified, let active):
            pieces[torrentID] = IOSPieceActivity(
                pieceCount: count,
                verified: verified,
                active: active
            )
        case .sessionCurrentRates(let rates):
            currentRates = rates
        case .sessionSpeedHistory(let history):
            speed = history
        default:
            return
        }
    }

    private func applyPatch(_ patch: ViewPatch) throws {
        switch patch {
        case .torrentList(let upsert, let updates, let removed, let storage, let settings):
            var values = Dictionary(uniqueKeysWithValues: torrents.map { ($0.torrentId, $0) })
            removed.forEach { values.removeValue(forKey: $0) }
            upsert.forEach { values[$0.torrentId] = $0 }
            for update in updates {
                guard let current = values[update.torrentId] else {
                    throw IOSPresentationError.discontinuity
                }
                values[update.torrentId] = try Self.apply(update, to: current)
            }
            torrents = Self.sorted(Array(values.values))
            if let storage { self.storage = storage }
            if let settings { self.fileSafetySettings = settings.configured.fileSafety }
            onProductUpdate?(torrents)
        case .torrent(let change):
            switch change {
            case .replace(let torrent):
                guard let torrent else { return }
                replaceTorrent(torrent)
            case .update(let update):
                guard let current = torrents.first(where: { $0.torrentId == update.torrentId }) else {
                    throw IOSPresentationError.discontinuity
                }
                replaceTorrent(try Self.apply(update, to: current))
            }
        case .torrentPreparation(let torrentID, let preparation):
            preparations[torrentID] = preparation
        case .files(let torrentID, let upsert, let updates, let removed):
            var values = Dictionary(
                uniqueKeysWithValues: files[torrentID, default: []].map { ($0.fileId, $0) }
            )
            removed.forEach { values.removeValue(forKey: $0) }
            upsert.forEach { values[$0.fileId] = $0 }
            for update in updates {
                guard let current = values[update.fileId] else {
                    throw IOSPresentationError.discontinuity
                }
                values[update.fileId] = try Self.apply(update, to: current)
            }
            files[torrentID] = values.values.sorted { $0.fileIndex < $1.fileIndex }
        case .media(let torrentID, let upsert, let removed):
            var values = Dictionary(
                uniqueKeysWithValues: media[torrentID, default: []].map { ($0.mediaId, $0) }
            )
            removed.forEach { values.removeValue(forKey: $0) }
            upsert.forEach { values[$0.mediaId] = $0 }
            media[torrentID] = values.values.sorted { $0.fileIndex < $1.fileIndex }
        case .trackers(let torrentID, let upsert, let removed):
            var values = Dictionary(
                uniqueKeysWithValues: trackers[torrentID, default: []].map { ($0.trackerId, $0) }
            )
            removed.forEach { values.removeValue(forKey: $0) }
            upsert.forEach { values[$0.trackerId] = $0 }
            trackers[torrentID] = values.values.sorted(by: Self.trackerOrder)
        case .peers(let torrentID, let upsert, let updates, let removed):
            var values = Dictionary(
                uniqueKeysWithValues: peers[torrentID, default: []].map { ($0.connectionId, $0) }
            )
            removed.forEach { values.removeValue(forKey: $0) }
            upsert.forEach { values[$0.connectionId] = $0 }
            for update in updates {
                guard let current = values[update.connectionId] else {
                    throw IOSPresentationError.discontinuity
                }
                values[update.connectionId] = try Self.apply(update, to: current)
            }
            peers[torrentID] = values.values.sorted { $0.connectionId < $1.connectionId }
        case .pieceActivity(
            let torrentID,
            let count,
            let verified,
            let cleared,
            let activeUpsert,
            let activeUpdates,
            let activeRemoved
        ):
            var ranges = pieces[torrentID]?.verified ?? []
            cleared.forEach { ranges = Self.remove($0, from: ranges) }
            verified.forEach { ranges = Self.insert($0, into: ranges) }
            var active = Dictionary(
                uniqueKeysWithValues: (pieces[torrentID]?.active ?? []).map { ($0.pieceId, $0) }
            )
            activeRemoved.forEach { active.removeValue(forKey: $0) }
            activeUpsert.forEach { active[$0.pieceId] = $0 }
            for update in activeUpdates {
                guard let current = active[update.pieceId] else {
                    throw IOSPresentationError.discontinuity
                }
                active[update.pieceId] = try Self.apply(update, to: current)
            }
            pieces[torrentID] = IOSPieceActivity(
                pieceCount: count,
                verified: ranges,
                active: active.values.sorted { $0.pieceIndex < $1.pieceIndex }
            )
        case .sessionCurrentRates(let rates):
            currentRates = rates
        case .sessionSpeedHistory(let append):
            guard let speed else { throw IOSPresentationError.discontinuity }
            self.speed = try Self.apply(append, to: speed)
        default:
            return
        }
    }

    private static func apply(
        _ append: SpeedHistoryAppend,
        to history: SpeedHistoryView
    ) throws -> SpeedHistoryView {
        guard
            history.historyEpoch == append.historyEpoch,
            history.completeThroughMillis == append.baseCompleteThroughMillis,
            let bucket = UInt64(history.bucketMillis),
            bucket > 0,
            let base = UInt64(append.baseCompleteThroughMillis),
            let through = UInt64(append.completeThroughMillis),
            through >= base,
            (through - base) % bucket == 0
        else {
            throw IOSPresentationError.discontinuity
        }
        let countValue = (through - base) / bucket
        let window = history.series.first?.values.count ?? 0
        guard countValue <= UInt64(window) else {
            throw IOSPresentationError.discontinuity
        }
        let count = Int(countValue)
        let (historySpan, overflow) = bucket.multipliedReportingOverflow(
            by: UInt64(max(0, window - 1))
        )
        let expectedStart = !overflow && through > historySpan ? through - historySpan : 0
        let shapeIsValid = count == 0
            ? append.persistence != nil && append.series.isEmpty
            : append.series.count == history.series.count
        guard
            UInt64(append.startMillis) == expectedStart,
            shapeIsValid
        else {
            throw IOSPresentationError.discontinuity
        }
        if count != 0 {
            for index in history.series.indices {
                guard
                    history.series[index].metric == append.series[index].metric,
                    append.series[index].values.count == count
                else {
                    throw IOSPresentationError.discontinuity
                }
            }
        }
        var next = history
        next.capturedMillis = append.capturedMillis
        next.startMillis = append.startMillis
        next.completeThroughMillis = append.completeThroughMillis
        if let persistence = append.persistence { next.persistence = persistence }
        next.series = history.series.enumerated().map { index, series in
            var updated = series
            if count != 0 {
                updated.values = Array(series.values.dropFirst(count)) + append.series[index].values
            }
            return updated
        }
        return next
    }

    private static func requireUnique<T>(
        _ fields: [T],
        key: (T) -> Int
    ) throws {
        // These keys only detect duplicate enum cases in memory. They are not
        // serialized field numbers for a future binary view codec.
        guard !fields.isEmpty, Set(fields.map(key)).count == fields.count else {
            throw IOSPresentationError.discontinuity
        }
    }

    private static func apply(
        _ update: TorrentRowUpdate,
        to current: TorrentView
    ) throws -> TorrentView {
        guard update.torrentId == current.torrentId else {
            throw IOSPresentationError.discontinuity
        }
        try requireUnique(update.fields, key: torrentFieldKey)
        var next = current
        for field in update.fields {
            switch field {
            case .protocolIdentities(let value): next.protocolIdentities = value
            case .displayName(let value): next.displayName = value
            case .sourceDisplayName(let value): next.sourceDisplayName = value
            case .sourceSizeBytes(let value): next.sourceSizeBytes = value
            case .state(let value): next.state = value
            case .operationalState(let value): next.operationalState = value
            case .downloadQueuePosition(let value): next.downloadQueuePosition = value
            case .transferLimits(let value): next.transferLimits = value
            case .storageState(let value): next.storageState = value
            case .metadataAvailable(let value): next.metadataAvailable = value
            case .privateTorrent(let value): next.privateTorrent = value
            case .awaitingFileSelection(let value): next.awaitingFileSelection = value
            case .pendingFileSelectionPosition(let value):
                next.pendingFileSelectionPosition = value
            case .fileCatalogId(let value): next.fileCatalogId = value
            case .safetySummary(let value): next.safetySummary = value
            case .selectableFileCount(let value): next.selectableFileCount = value
            case .selectedFileCount(let value): next.selectedFileCount = value
            case .selectableFileBytes(let value): next.selectableFileBytes = value
            case .selectedFileBytes(let value): next.selectedFileBytes = value
            case .pieceCount(let value): next.pieceCount = value
            case .totalSizeBytes(let value): next.totalSizeBytes = value
            case .verifiedPieceCount(let value): next.verifiedPieceCount = value
            case .requestedBytes(let value): next.requestedBytes = value
            case .receivedBytes(let value): next.receivedBytes = value
            case .storedBytes(let value): next.storedBytes = value
            case .activePeerConnections(let value): next.activePeerConnections = value
            case .configuredTrackerCount(let value): next.configuredTrackerCount = value
            case .payloadDownloadRateBytes(let value): next.payloadDownloadRateBytes = value
            case .requiredPayloadBytes(let value): next.requiredPayloadBytes = value
            case .remainingPayloadBytes(let value): next.remainingPayloadBytes = value
            case .etaPayloadDownloadRateBytes(let value): next.etaPayloadDownloadRateBytes = value
            case .eta(let value): next.eta = value
            case .lifetime(let value): next.lifetime = value
            case .seeding(let value): next.seeding = value
            case .progress(let value): next.progress = value
            case .checking(let value): next.checking = value
            case .archived(let value): next.archived = value
            case .removalState(let value): next.removalState = value
            case .deleteDataSupported(let value): next.deleteDataSupported = value
            case .forceRecheckAvailable(let value): next.forceRecheckAvailable = value
            case .error(let value): next.error = value
            }
        }
        return next
    }

    private static func torrentFieldKey(_ field: TorrentFieldUpdate) -> Int {
        switch field {
        case .protocolIdentities: return 0
        case .displayName: return 1
        case .sourceDisplayName: return 2
        case .state: return 3
        case .operationalState: return 4
        case .downloadQueuePosition: return 5
        case .transferLimits: return 6
        case .storageState: return 7
        case .metadataAvailable: return 8
        case .privateTorrent: return 38
        case .sourceSizeBytes: return 39
        case .awaitingFileSelection: return 31
        case .pendingFileSelectionPosition: return 32
        case .fileCatalogId: return 33
        case .safetySummary: return 40
        case .selectableFileCount: return 34
        case .selectedFileCount: return 35
        case .selectableFileBytes: return 36
        case .selectedFileBytes: return 37
        case .pieceCount: return 9
        case .totalSizeBytes: return 28
        case .verifiedPieceCount: return 10
        case .requestedBytes: return 11
        case .receivedBytes: return 12
        case .storedBytes: return 13
        case .activePeerConnections: return 14
        case .configuredTrackerCount: return 15
        case .payloadDownloadRateBytes: return 16
        case .requiredPayloadBytes: return 17
        case .remainingPayloadBytes: return 18
        case .etaPayloadDownloadRateBytes: return 19
        case .eta: return 20
        case .lifetime: return 29
        case .seeding: return 30
        case .progress: return 21
        case .checking: return 22
        case .archived: return 23
        case .removalState: return 24
        case .deleteDataSupported: return 25
        case .forceRecheckAvailable: return 26
        case .error: return 27
        }
    }

    private static func apply(_ update: FileRowUpdate, to current: FileView) throws -> FileView {
        guard update.fileId == current.fileId else { throw IOSPresentationError.discontinuity }
        try requireUnique(update.fields, key: fileFieldKey)
        var next = current
        for field in update.fields {
            switch field {
            case .safety(let value): next.safety = value
            case .selection(let value): next.selection = value
            case .doneBytes(let value): next.doneBytes = value
            case .verifiedBytes(let value): next.verifiedBytes = value
            case .mediaAvailability(let value): next.mediaAvailability = value
            }
        }
        return next
    }

    private static func fileFieldKey(_ field: FileFieldUpdate) -> Int {
        switch field {
        case .safety: return 4
        case .selection: return 0
        case .doneBytes: return 1
        case .verifiedBytes: return 2
        case .mediaAvailability: return 3
        }
    }

    private static func apply(_ update: PeerRowUpdate, to current: PeerView) throws -> PeerView {
        guard update.connectionId == current.connectionId else {
            throw IOSPresentationError.discontinuity
        }
        try requireUnique(update.fields, key: peerFieldKey)
        var next = current
        for field in update.fields {
            switch field {
            case .peerRecordId(let value): next.peerRecordId = value
            case .direction(let value): next.direction = value
            case .transport(let value): next.transport = value
            case .lifecycle(let value): next.lifecycle = value
            case .role(let value): next.role = value
            case .peerFlags(let value): next.peerFlags = value
            case .mseMethod(let value): next.mseMethod = value
            case .lifecycleAgeMillis(let value): next.lifecycleAgeMillis = value
            case .remoteEndpoint(let value): next.remoteEndpoint = value
            case .localEndpoint(let value): next.localEndpoint = value
            case .sources(let value): next.sources = value
            case .peerId(let value): next.peerId = value
            case .clientName(let value): next.clientName = value
            case .supportsExtensions(let value): next.supportsExtensions = value
            case .supportsUtMetadata(let value): next.supportsUtMetadata = value
            case .localInterested(let value): next.localInterested = value
            case .remoteInterested(let value): next.remoteInterested = value
            case .remoteChoking(let value): next.remoteChoking = value
            case .localChoking(let value): next.localChoking = value
            case .availablePieceCount(let value): next.availablePieceCount = value
            case .wantedPieceCount(let value): next.wantedPieceCount = value
            case .payloadDownloadRateBytes(let value): next.payloadDownloadRateBytes = value
            case .payloadDownloadedBytes(let value): next.payloadDownloadedBytes = value
            case .protocolDownloadRateBytes(let value): next.protocolDownloadRateBytes = value
            case .protocolDownloadedBytes(let value): next.protocolDownloadedBytes = value
            case .payloadUploadRateBytes(let value): next.payloadUploadRateBytes = value
            case .payloadUploadedBytes(let value): next.payloadUploadedBytes = value
            case .pendingRequests(let value): next.pendingRequests = value
            case .targetRequests(let value): next.targetRequests = value
            case .queuedPayloadBytes(let value): next.queuedPayloadBytes = value
            case .oldestRequestAgeMillis(let value): next.oldestRequestAgeMillis = value
            case .requestTimeoutMillis(let value): next.requestTimeoutMillis = value
            case .requestPhase(let value): next.requestPhase = value
            case .connectedAgeMillis(let value): next.connectedAgeMillis = value
            case .lastUsefulAgeMillis(let value): next.lastUsefulAgeMillis = value
            case .lastPayloadAgeMillis(let value): next.lastPayloadAgeMillis = value
            case .disconnectReason(let value): next.disconnectReason = value
            case .capabilities(let value): next.capabilities = value
            }
        }
        return next
    }

    private static func peerFieldKey(_ field: PeerFieldUpdate) -> Int {
        switch field {
        case .peerRecordId: return 0
        case .direction: return 1
        case .transport: return 2
        case .lifecycle: return 3
        case .role: return 4
        case .peerFlags: return 5
        case .mseMethod: return 6
        case .lifecycleAgeMillis: return 7
        case .remoteEndpoint: return 8
        case .localEndpoint: return 9
        case .sources: return 10
        case .peerId: return 11
        case .clientName: return 12
        case .supportsExtensions: return 13
        case .supportsUtMetadata: return 14
        case .localInterested: return 15
        case .remoteInterested: return 16
        case .remoteChoking: return 17
        case .localChoking: return 18
        case .availablePieceCount: return 19
        case .wantedPieceCount: return 20
        case .payloadDownloadRateBytes: return 21
        case .payloadDownloadedBytes: return 22
        case .protocolDownloadRateBytes: return 23
        case .protocolDownloadedBytes: return 24
        case .payloadUploadRateBytes: return 25
        case .payloadUploadedBytes: return 26
        case .pendingRequests: return 27
        case .targetRequests: return 28
        case .queuedPayloadBytes: return 29
        case .oldestRequestAgeMillis: return 30
        case .requestTimeoutMillis: return 31
        case .requestPhase: return 32
        case .connectedAgeMillis: return 33
        case .lastUsefulAgeMillis: return 34
        case .lastPayloadAgeMillis: return 35
        case .disconnectReason: return 36
        case .capabilities: return 37
        }
    }

    private static func apply(
        _ update: ActivePieceUpdate,
        to current: ActivePiece
    ) throws -> ActivePiece {
        guard update.pieceId == current.pieceId else { throw IOSPresentationError.discontinuity }
        try requireUnique(update.fields, key: activePieceFieldKey)
        var next = current
        for field in update.fields {
            switch field {
            case .stage(let value): next.stage = value
            case .requested(let value): next.requested = value
            case .received(let value): next.received = value
            case .stored(let value): next.stored = value
            case .ageMillis(let value): next.ageMillis = value
            case .error(let value): next.error = value
            }
        }
        return next
    }

    private static func activePieceFieldKey(_ field: ActivePieceFieldUpdate) -> Int {
        switch field {
        case .stage: return 0
        case .requested: return 1
        case .received: return 2
        case .stored: return 3
        case .ageMillis: return 4
        case .error: return 5
        }
    }

    private func replaceTorrent(_ torrent: TorrentView) {
        var values = Dictionary(uniqueKeysWithValues: torrents.map { ($0.torrentId, $0) })
        values[torrent.torrentId] = torrent
        torrents = Self.sorted(Array(values.values))
        onProductUpdate?(torrents)
    }

    private static func insert(_ inserted: IndexRange, into ranges: [IndexRange]) -> [IndexRange] {
        var start = inserted.start
        var end = inserted.endExclusive
        var output: [IndexRange] = []
        var placed = false
        for range in ranges {
            if range.endExclusive < start {
                output.append(range)
            } else if end < range.start {
                if !placed {
                    output.append(IndexRange(start: start, endExclusive: end))
                    placed = true
                }
                output.append(range)
            } else {
                start = min(start, range.start)
                end = max(end, range.endExclusive)
            }
        }
        if !placed { output.append(IndexRange(start: start, endExclusive: end)) }
        return output
    }

    private static func remove(_ removed: IndexRange, from ranges: [IndexRange]) -> [IndexRange] {
        ranges.flatMap { range -> [IndexRange] in
            if range.endExclusive <= removed.start || range.start >= removed.endExclusive {
                return [range]
            }
            var fragments: [IndexRange] = []
            if range.start < removed.start {
                fragments.append(IndexRange(start: range.start, endExclusive: removed.start))
            }
            if range.endExclusive > removed.endExclusive {
                fragments.append(
                    IndexRange(start: removed.endExclusive, endExclusive: range.endExclusive)
                )
            }
            return fragments
        }
    }

    private static func sorted(_ torrents: [TorrentView]) -> [TorrentView] {
        torrents.sorted {
            let left = $0.downloadQueuePosition ?? UInt32.max
            let right = $1.downloadQueuePosition ?? UInt32.max
            if left != right { return left < right }
            let firstName = $0.displayName ?? $0.sourceDisplayName ?? $0.torrentId
            let secondName = $1.displayName ?? $1.sourceDisplayName ?? $1.torrentId
            return firstName.localizedStandardCompare(secondName) == .orderedAscending
        }
    }

    private static func trackerOrder(_ first: TrackerView, _ second: TrackerView) -> Bool {
        if first.tier != second.tier { return first.tier < second.tier }
        return first.url < second.url
    }
}
