import Darwin
import Foundation
import RSTorrentIOS

final class PlatformStorageBridge: @unchecked Sendable {
    private let client: IosApplicationClient
    private let roots: [String: SelectedRootRecord]
    private let appOwnedRoots: [String: URL]
    private let leases = CoordinatedLeaseLedger()
    private let workers = DispatchGroup()
    private let stateLock = NSLock()
    private var requestTask: Task<Void, Never>?
    private var releaseTask: Task<Void, Never>?
    private var stopped = false

    init(
        client: IosApplicationClient,
        roots: [SelectedRootRecord],
        appOwnedRoots: [String: URL] = [:]
    ) {
        self.client = client
        self.roots = Dictionary(uniqueKeysWithValues: roots.map { ($0.id, $0) })
        self.appOwnedRoots = appOwnedRoots
    }

    func start() {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard requestTask == nil, releaseTask == nil, !stopped else { return }
        requestTask = Task { [weak self] in await self?.requestLoop() }
        releaseTask = Task { [weak self] in await self?.releaseLoop() }
    }

    func stopAfterClientShutdown() async {
        stateLock.lock()
        stopped = true
        let requestTask = requestTask
        let releaseTask = releaseTask
        stateLock.unlock()
        requestTask?.cancel()
        releaseTask?.cancel()
        leases.releaseAll()
        _ = await Task.detached { [workers] in
            workers.wait(timeout: .now() + 5) == .success
        }.value
    }

    func resourceSnapshot() -> PlatformBridgeResourceSnapshot {
        PlatformBridgeResourceSnapshot(
            activeWorkers: workersActiveCount,
            activeLeases: leases.count
        )
    }

    func removeData(_ plan: IosRemovalPlan) throws {
        guard let record = roots[plan.storageRoot] else {
            throw StorageBridgeError.unregisteredRoot(plan.storageRoot)
        }
        let root = try RootAccess.resolveBookmark(record.bookmarkData)
        try RootAccess.withSecurityScope(root) {
            let content = try Self.storageTarget(root: root, components: [plan.name])
            let part = try Self.storageTarget(
                root: root,
                components: [".\(plan.torrentId).rstorrent-parts"]
            )
            if let partKind = try Self.storageItemKind(at: part), partKind != .file {
                throw StorageBridgeError.removalTargetHasWrongKind
            }
            var manifestFiles: [URL] = []
            var payloadFiles: [URL] = []
            var payloadDirectories: [URL] = []
            if !plan.tree {
                for manifest in plan.downloadManifests {
                    let target = try Self.storageTarget(root: root, components: [manifest])
                    // Only a regular file is a sidecar; anything else is left alone.
                    if try Self.storageItemKind(at: target) == .file {
                        manifestFiles.append(target)
                    }
                }
            }
            if let contentKind = try Self.storageItemKind(at: content) {
                guard contentKind == (plan.tree ? .directory : .file) else {
                    throw StorageBridgeError.removalTargetHasWrongKind
                }
                if plan.tree {
                    // PlaysVideo sidecars go first so the directory is pruned.
                    for manifest in plan.downloadManifests {
                        let target = try Self.storageTarget(root: content, components: [manifest])
                        if try Self.storageItemKind(at: target) == .file {
                            manifestFiles.append(target)
                        }
                    }
                    for path in plan.files {
                        if let target = try Self.resolveRemovalTarget(
                            root: content,
                            components: path.components,
                            leafKind: .file
                        ) { payloadFiles.append(target) }
                    }
                    for path in plan.directories {
                        if let target = try Self.resolveRemovalTarget(
                            root: content,
                            components: path.components,
                            leafKind: .directory
                        ) { payloadDirectories.append(target) }
                    }
                } else {
                    payloadFiles.append(content)
                }
            }
            for file in manifestFiles + payloadFiles {
                try removeExactFile(file)
            }
            if try Self.storageItemKind(at: part) != nil {
                try removeExactFile(part)
            }
            for directory in payloadDirectories {
                try removeEmptyDirectory(directory)
            }
        }
    }

    func openShareableFile(_ plan: IosFilePlan) throws -> ShareableFileLease {
        if let root = appOwnedRoots[plan.storageRoot] {
            return try Self.coordinatedShareableFile(
                root: root,
                components: plan.components,
                length: plan.length,
                scopedRoot: nil
            )
        }
        guard let record = roots[plan.storageRoot] else {
            throw StorageBridgeError.unregisteredRoot(plan.storageRoot)
        }
        let root = try RootAccess.resolveBookmark(record.bookmarkData)
        guard root.startAccessingSecurityScopedResource() else {
            throw RootAccessError.securityScopeDenied
        }
        do {
            return try Self.coordinatedShareableFile(
                root: root,
                components: plan.components,
                length: plan.length,
                scopedRoot: root
            )
        } catch {
            root.stopAccessingSecurityScopedResource()
            throw error
        }
    }

    static func coordinatedShareableFile(
        root: URL,
        components: [String],
        length: UInt64,
        scopedRoot: URL?
    ) throws -> ShareableFileLease {
        let target = try storageTarget(root: root, components: components)
        var coordinationError: NSError?
        var result: Result<URL, Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: target,
            options: .withoutChanges,
            error: &coordinationError
        ) { coordinatedURL in
            result = Result {
                try validateCoordinatedTarget(coordinatedURL, requested: target)
                let observation = try observe(root: root, components: components)
                guard observation.exists, observation.kind == .file else {
                    throw StorageBridgeError.shareTargetIsNotFile
                }
                guard observation.length == length else {
                    throw StorageBridgeError.shareTargetLengthChanged
                }
                return coordinatedURL
            }
        }
        if let coordinationError {
            throw RootAccessError.coordinationFailed(
                coordinationError.localizedDescription
            )
        }
        guard let result else {
            throw RootAccessError.coordinationAccessorDidNotRun
        }
        return ShareableFileLease(url: try result.get(), scopedRoot: scopedRoot)
    }

    private func removeExactFile(_ target: URL) throws {
        try withCoordinatedWriting(at: target, options: .forDeleting) { coordinatedTarget in
            let status = coordinatedTarget.path.withCString { unlink($0) }
            guard status == 0 || errno == ENOENT else {
                throw POSIXFailure(operation: "remove torrent data file", code: errno)
            }
        }
    }

    private func removeEmptyDirectory(_ target: URL) throws {
        try withCoordinatedWriting(at: target, options: .forDeleting) { coordinatedTarget in
            let status = coordinatedTarget.path.withCString { rmdir($0) }
            guard status == 0 || errno == ENOENT || errno == ENOTEMPTY else {
                throw POSIXFailure(operation: "remove empty torrent data directory", code: errno)
            }
        }
    }

    private var workersActiveCount: Int {
        workerCounterLock.lock()
        defer { workerCounterLock.unlock() }
        return workerCounter
    }

    private func withCoordinatedWriting<T>(
        at target: URL,
        options: NSFileCoordinator.WritingOptions,
        body: (URL) throws -> T
    ) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: target,
            options: options,
            error: &coordinationError
        ) { coordinatedTarget in
            result = Result {
                try Self.validateCoordinatedTarget(coordinatedTarget, requested: target)
                return try body(coordinatedTarget)
            }
        }
        if let coordinationError {
            throw RootAccessError.coordinationFailed(coordinationError.localizedDescription)
        }
        guard let result else {
            throw RootAccessError.coordinationAccessorDidNotRun
        }
        return try result.get()
    }

    private let workerCounterLock = NSLock()
    private var workerCounter = 0

    private func requestLoop() async {
        while !Task.isCancelled, let request = await client.nextStorageRequest() {
            workers.enter()
            workerCounterLock.lock()
            workerCounter += 1
            workerCounterLock.unlock()
            Task.detached { [weak self] in
                defer {
                    if let self {
                        self.workerCounterLock.lock()
                        self.workerCounter -= 1
                        self.workerCounterLock.unlock()
                        self.workers.leave()
                    }
                }
                self?.perform(request)
            }
        }
    }

    private func releaseLoop() async {
        while !Task.isCancelled, let releaseID = await client.nextStorageRelease() {
            guard let lease = leases.take(releaseID) else {
                _ = client.acknowledgeStorageRelease(releaseId: releaseID)
                continue
            }
            await Task.detached {
                lease.release()
                lease.waitUntilFinished()
            }.value
            _ = client.acknowledgeStorageRelease(releaseId: releaseID)
        }
    }

    private func perform(_ request: IosStorageRequest) {
        guard let record = roots[request.rootId] else {
            fail(request, .grantUnavailable, "selected root is not registered")
            return
        }
        do {
            let rootURL = try RootAccess.resolveBookmark(record.bookmarkData)
            try RootAccess.withSecurityScope(rootURL) {
                switch request.operation {
                case .open:
                    try coordinatedOpen(request, rootURL: rootURL)
                case .observe:
                    try coordinatedObservation(request, rootURL: rootURL)
                case .delete:
                    try coordinatedDelete(request, rootURL: rootURL)
                }
            }
        } catch let error as RootAccessError {
            fail(request, .grantUnavailable, error.localizedDescription)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            fail(request, .missing, error.localizedDescription)
        } catch let error as POSIXFailure where error.code == ENOENT {
            fail(request, .missing, error.localizedDescription)
        } catch let error as POSIXFailure where error.code == EACCES || error.code == EPERM {
            fail(request, .permissionDenied, error.localizedDescription)
        } catch let error as POSIXFailure where
            error.code == ELOOP || error.code == ENOTDIR || error.code == EISDIR
        {
            fail(request, .wrongKind, error.localizedDescription)
        } catch {
            fail(request, .providerRefused, error.localizedDescription)
        }
    }

    private func coordinatedOpen(_ request: IosStorageRequest, rootURL: URL) throws {
        var coordinationError: NSError?
        var accessorError: Error?
        var accessorRan = false
        let lease = CoordinatedLease()
        let releaseID = leases.allocate(lease)
        let target = try Self.storageTarget(root: rootURL, components: request.path)
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: target,
            options: .forMerging,
            error: &coordinationError
        ) { coordinatedTarget in
            accessorRan = true
            do {
                try Self.validateCoordinatedTarget(coordinatedTarget, requested: target)
                let descriptor = try Self.openDescriptor(
                    root: rootURL,
                    components: request.path,
                    access: request.access
                )
                defer { Darwin.close(descriptor) }
                let accepted = try client.completeStorageRequest(
                    requestId: request.requestId,
                    fd: descriptor,
                    access: request.access,
                    releaseId: releaseID
                )
                if accepted {
                    lease.waitForRelease()
                } else {
                    leases.cancel(releaseID)
                }
            } catch {
                leases.cancel(releaseID)
                accessorError = error
            }
        }
        lease.finished()
        if let coordinationError {
            throw RootAccessError.coordinationFailed(coordinationError.localizedDescription)
        }
        guard accessorRan else {
            throw RootAccessError.coordinationAccessorDidNotRun
        }
        if let accessorError { throw accessorError }
    }

    private func coordinatedObservation(_ request: IosStorageRequest, rootURL: URL) throws {
        var coordinationError: NSError?
        var accessorError: Error?
        var accessorRan = false
        let target = try Self.storageTarget(root: rootURL, components: request.path)
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: target,
            options: [],
            error: &coordinationError
        ) { coordinatedTarget in
            accessorRan = true
            do {
                try Self.validateCoordinatedTarget(coordinatedTarget, requested: target)
                let observation = try Self.observe(
                    root: rootURL,
                    components: request.path
                )
                _ = try client.completeStorageObservation(
                    requestId: request.requestId,
                    observation: observation
                )
            } catch {
                accessorError = error
            }
        }
        if let coordinationError {
            throw RootAccessError.coordinationFailed(coordinationError.localizedDescription)
        }
        guard accessorRan else {
            throw RootAccessError.coordinationAccessorDidNotRun
        }
        if let accessorError { throw accessorError }
    }

    private func coordinatedDelete(_ request: IosStorageRequest, rootURL: URL) throws {
        var coordinationError: NSError?
        var accessorError: Error?
        var accessorRan = false
        let target = try Self.storageTarget(root: rootURL, components: request.path)
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: target,
            options: .forDeleting,
            error: &coordinationError
        ) { coordinatedTarget in
            accessorRan = true
            do {
                try Self.validateCoordinatedTarget(coordinatedTarget, requested: target)
                try Self.delete(root: rootURL, components: request.path)
                _ = client.completeStorageDelete(requestId: request.requestId)
            } catch {
                accessorError = error
            }
        }
        if let coordinationError {
            throw RootAccessError.coordinationFailed(coordinationError.localizedDescription)
        }
        guard accessorRan else {
            throw RootAccessError.coordinationAccessorDidNotRun
        }
        if let accessorError { throw accessorError }
    }

    private static func storageItemKind(at target: URL) throws -> StorageItemKind? {
        do {
            let values = try target.resourceValues(
                forKeys: [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey]
            )
            if values.isSymbolicLink == true { return .other }
            if values.isRegularFile == true { return .file }
            if values.isDirectory == true { return .directory }
            return .other
        } catch let error as CocoaError where
            error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile
        {
            return nil
        }
    }

    private static func resolveRemovalTarget(
        root: URL,
        components: [String],
        leafKind: StorageItemKind
    ) throws -> URL? {
        var target = root
        if components.isEmpty {
            guard try storageItemKind(at: target) == leafKind else {
                throw StorageBridgeError.removalTargetHasWrongKind
            }
            return target
        }
        for (index, component) in components.enumerated() {
            target = try storageTarget(root: target, components: [component])
            guard let kind = try storageItemKind(at: target) else { return nil }
            let expected = index + 1 == components.count ? leafKind : .directory
            guard kind == expected else {
                throw StorageBridgeError.removalTargetHasWrongKind
            }
        }
        return target
    }

    static func storageTarget(root: URL, components: [String]) throws -> URL {
        guard root.isFileURL else {
            throw POSIXFailure(operation: "validate storage target", code: EINVAL)
        }
        var target = root
        for component in components {
            guard
                !component.isEmpty,
                component != ".",
                component != "..",
                !component.contains("/"),
                !component.utf8.contains(0)
            else {
                throw POSIXFailure(operation: "validate path component", code: EINVAL)
            }
            target.appendPathComponent(component, isDirectory: false)
        }
        return target
    }

    static func validateCoordinatedTarget(_ coordinated: URL, requested: URL) throws {
        guard
            coordinated.isFileURL,
            coordinated.standardizedFileURL.path == requested.standardizedFileURL.path
        else {
            throw StorageBridgeError.coordinatedTargetChanged
        }
    }

    static func openDescriptor(
        root: URL,
        components: [String],
        access: IosStorageAccess
    ) throws -> Int32 {
        let createParents = access == .readWriteCreate
        let (parent, leaf) = try openParent(
            root: root,
            components: components,
            createDirectories: createParents
        )
        defer { Darwin.close(parent) }

        let flags: Int32
        switch access {
        case .readExisting:
            flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW
        case .readWriteExisting:
            flags = O_RDWR | O_CLOEXEC | O_NOFOLLOW
        case .readWriteCreate:
            flags = O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW
        }
        let descriptor = leaf.withCString {
            Darwin.openat(parent, $0, flags, S_IRUSR | S_IWUSR)
        }
        guard descriptor >= 0 else {
            throw POSIXFailure(operation: "open storage file", code: errno)
        }
        do {
            var status = Darwin.stat()
            guard Darwin.fstat(descriptor, &status) == 0 else {
                throw POSIXFailure(operation: "inspect storage file", code: errno)
            }
            guard status.st_mode & S_IFMT == S_IFREG else {
                throw POSIXFailure(operation: "require regular storage file", code: EISDIR)
            }
            return descriptor
        } catch {
            Darwin.close(descriptor)
            throw error
        }
    }

    static func observe(root: URL, components: [String]) throws -> IosStorageObservation {
        if components.isEmpty {
            let descriptor = Darwin.open(
                root.path,
                O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
            )
            guard descriptor >= 0 else {
                if errno == ENOENT { return missingObservation() }
                throw POSIXFailure(operation: "open selected root", code: errno)
            }
            defer { Darwin.close(descriptor) }
            var status = Darwin.stat()
            guard Darwin.fstat(descriptor, &status) == 0 else {
                throw POSIXFailure(operation: "observe selected root", code: errno)
            }
            return observation(from: status)
        }

        let parentAndLeaf: (Int32, String)
        do {
            parentAndLeaf = try openParent(
                root: root,
                components: components,
                createDirectories: false
            )
        } catch let error as POSIXFailure where error.code == ENOENT {
            return missingObservation()
        }
        let (parent, leaf) = parentAndLeaf
        defer { Darwin.close(parent) }

        var status = Darwin.stat()
        let result = leaf.withCString {
            Darwin.fstatat(parent, $0, &status, AT_SYMLINK_NOFOLLOW)
        }
        if result != 0, errno == ENOENT {
            return missingObservation()
        }
        guard result == 0 else {
            throw POSIXFailure(operation: "observe storage file", code: errno)
        }
        return observation(from: status)
    }

    private static func observation(from status: Darwin.stat) -> IosStorageObservation {
        let fileType = status.st_mode & S_IFMT
        let kind: IosStorageObjectKind
        if fileType == S_IFREG {
            kind = .file
        } else if fileType == S_IFDIR {
            kind = .directory
        } else {
            kind = .other
        }
        let length = kind == .file ? UInt64(max(0, status.st_size)) : nil
        let seconds = Int64(status.st_mtimespec.tv_sec)
        let nanoseconds = Int64(status.st_mtimespec.tv_nsec)
        let (scaledSeconds, overflowed) = seconds.multipliedReportingOverflow(by: 1_000_000_000)
        let modified = overflowed ? nil : scaledSeconds.addingReportingOverflow(nanoseconds)
        let token = modified.flatMap { value, overflowed in
            overflowed ? nil : "mtime-ns:\(value)"
        }
        return IosStorageObservation(
            exists: true,
            kind: kind,
            length: length,
            opaqueToken: token
        )
    }

    static func delete(root: URL, components: [String]) throws {
        let parentAndLeaf: (Int32, String)
        do {
            parentAndLeaf = try openParent(
                root: root,
                components: components,
                createDirectories: false
            )
        } catch let error as POSIXFailure where error.code == ENOENT {
            return
        }
        let (parent, leaf) = parentAndLeaf
        defer { Darwin.close(parent) }
        let result = leaf.withCString { Darwin.unlinkat(parent, $0, 0) }
        guard result == 0 || errno == ENOENT else {
            throw POSIXFailure(operation: "delete storage file", code: errno)
        }
    }

    private static func openParent(
        root: URL,
        components: [String],
        createDirectories: Bool
    ) throws -> (Int32, String) {
        guard !components.isEmpty else {
            throw POSIXFailure(operation: "validate storage path", code: EINVAL)
        }
        _ = try storageTarget(root: root, components: components)
        var current = Darwin.open(
            root.path,
            O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
        )
        guard current >= 0 else {
            throw POSIXFailure(operation: "open selected root", code: errno)
        }
        do {
            for component in components.dropLast() {
                var next = component.withCString {
                    Darwin.openat(
                        current,
                        $0,
                        O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
                    )
                }
                if next < 0, errno == ENOENT, createDirectories {
                    let created = component.withCString {
                        Darwin.mkdirat(current, $0, S_IRWXU)
                    }
                    guard created == 0 || errno == EEXIST else {
                        throw POSIXFailure(operation: "create storage directory", code: errno)
                    }
                    next = component.withCString {
                        Darwin.openat(
                            current,
                            $0,
                            O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
                        )
                    }
                }
                guard next >= 0 else {
                    throw POSIXFailure(operation: "open storage directory", code: errno)
                }
                Darwin.close(current)
                current = next
            }
            return (current, components.last!)
        } catch {
            Darwin.close(current)
            throw error
        }
    }

    private static func missingObservation() -> IosStorageObservation {
        IosStorageObservation(
            exists: false,
            kind: nil,
            length: nil,
            opaqueToken: nil
        )
    }

    private func fail(
        _ request: IosStorageRequest,
        _ kind: IosStorageFailureKind,
        _ detail: String
    ) {
        _ = client.failStorageRequest(
            requestId: request.requestId,
            kind: kind,
            message: String(detail.prefix(1_024))
        )
    }
}

struct PlatformBridgeResourceSnapshot {
    var activeWorkers: Int
    var activeLeases: Int
}

private struct POSIXFailure: Error, LocalizedError {
    var operation: String
    var code: Int32

    var errorDescription: String? {
        "\(operation): \(String(cString: strerror(code)))"
    }
}

private enum StorageItemKind: Equatable {
    case file
    case directory
    case other
}

private enum StorageBridgeError: Error, LocalizedError {
    case coordinatedTargetChanged
    case removalTargetHasWrongKind
    case unregisteredRoot(String)
    case shareTargetIsNotFile
    case shareTargetLengthChanged

    var errorDescription: String? {
        switch self {
        case .coordinatedTargetChanged:
            return "file coordination changed the requested storage target"
        case .removalTargetHasWrongKind:
            return "torrent data removal target has an unexpected type"
        case .unregisteredRoot(let rootID):
            return "storage root \(rootID) is not registered with the platform bridge"
        case .shareTargetIsNotFile:
            return "the completed item is not a regular file"
        case .shareTargetLengthChanged:
            return "the completed file length changed after verification"
        }
    }
}

final class ShareableFileLease: Identifiable {
    let id = UUID()
    let url: URL
    private var scopedRoot: URL?

    init(url: URL, scopedRoot: URL?) {
        self.url = url
        self.scopedRoot = scopedRoot
    }

    func release() {
        scopedRoot?.stopAccessingSecurityScopedResource()
        scopedRoot = nil
    }

    deinit { release() }
}

private final class CoordinatedLease: @unchecked Sendable {
    private let releaseSemaphore = DispatchSemaphore(value: 0)
    private let finishedSemaphore = DispatchSemaphore(value: 0)

    func waitForRelease() { releaseSemaphore.wait() }
    func release() { releaseSemaphore.signal() }
    func finished() { finishedSemaphore.signal() }
    func waitUntilFinished() { finishedSemaphore.wait() }
}

private final class CoordinatedLeaseLedger: @unchecked Sendable {
    private let lock = NSLock()
    private var nextID: UInt64 = 1
    private var leases: [UInt64: CoordinatedLease] = [:]

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return leases.count
    }

    func allocate(_ lease: CoordinatedLease) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        let id = nextID
        nextID = nextID == UInt64.max ? 1 : nextID + 1
        precondition(leases[id] == nil, "release ID wrapped into a live lease")
        leases[id] = lease
        return id
    }

    func take(_ id: UInt64) -> CoordinatedLease? {
        lock.lock()
        defer { lock.unlock() }
        return leases.removeValue(forKey: id)
    }

    func cancel(_ id: UInt64) {
        take(id)?.release()
    }

    func releaseAll() {
        lock.lock()
        let active = Array(leases.values)
        leases.removeAll()
        lock.unlock()
        active.forEach { $0.release() }
    }
}
