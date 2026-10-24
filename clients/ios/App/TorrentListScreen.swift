import SwiftUI
import UniformTypeIdentifiers

private enum TorrentListFilter: CaseIterable, Identifiable {
    case all
    case active
    case finished

    var id: Self { self }
    var title: LocalizedStringResource {
        switch self {
        case .all: return LocalizedStringResource("filter_all")
        case .active: return LocalizedStringResource("filter_active")
        case .finished: return LocalizedStringResource("filter_finished")
        }
    }
    var emptyTitle: LocalizedStringResource {
        switch self {
        case .all: return LocalizedStringResource("torrent_list_empty_all")
        case .active: return LocalizedStringResource("torrent_list_empty_active")
        case .finished: return LocalizedStringResource("torrent_list_empty_finished")
        }
    }
    var emptyHint: LocalizedStringResource {
        switch self {
        case .all: return LocalizedStringResource("torrent_list_hint_all")
        case .active: return LocalizedStringResource("torrent_list_hint_active")
        case .finished: return LocalizedStringResource("torrent_list_hint_finished")
        }
    }
    func includes(_ torrent: TorrentListItem) -> Bool {
        switch self {
        case .all: return true
        case .active: return !torrent.isStopped && !torrent.isComplete
        case .finished: return torrent.isComplete
        }
    }
}

struct TorrentListScreen: View {
    @ObservedObject var appModel: AppModel
    @ObservedObject var presentation: IOSPresentationRepository
    let onOpenSettings: () -> Void
    let onTorrentSelected: (String) -> Void

    @State private var selectedFilter: TorrentListFilter = .all
    @State private var isPresentingAddTorrent = false
    @State private var isImportingTorrent = false
    @State private var pendingRemovalTorrent: TorrentListItem?
    @State private var magnetInput = ""
    @State private var actionError: String?

    private var torrents: [TorrentListItem] { presentation.torrents.map(TorrentListItem.init) }
    private var filteredTorrents: [TorrentListItem] { torrents.filter(selectedFilter.includes) }

    var body: some View {
        List {
            Section {
                FilterBar(selectedFilter: $selectedFilter)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
                RuntimeSummaryCard(status: appModel.engineStatus.text, torrentCount: torrents.count)
            }

            if let error = actionError ?? presentation.error {
                Section(String(localized: "torrent_list_error")) {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section(String(localized: "ios_runtime_torrents_label")) {
                if filteredTorrents.isEmpty {
                    EmptyTorrentState(filter: selectedFilter)
                } else {
                    ForEach(filteredTorrents) { torrent in
                        TorrentRowView(
                            torrent: torrent,
                            onOpen: { onTorrentSelected(torrent.id) },
                            onToggle: { toggle(torrent) },
                            onRemove: { pendingRemovalTorrent = torrent }
                        )
                        .swipeActions {
                            Button(
                                torrent.isStopped
                                    ? String(localized: "torrent_detail_resume_button")
                                    : String(localized: "torrent_detail_pause_button")
                            ) { toggle(torrent) }
                            .tint(.blue)
                            Button(
                                String(localized: "dialog_remove_confirm_button"),
                                role: .destructive
                            ) { pendingRemovalTorrent = torrent }
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("torrent-library")
        .listStyle(.insetGrouped)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            AppTopBar(
                onOpenSettings: onOpenSettings,
                onAddTorrent: { isPresentingAddTorrent = true }
            )
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .background(.thinMaterial)
        }
        .sheet(isPresented: $isPresentingAddTorrent) {
            AddTorrentSheet(
                magnetInput: $magnetInput,
                onAdd: { addMagnet() },
                onBrowse: { isImportingTorrent = true }
            )
        }
        .fileImporter(
            isPresented: $isImportingTorrent,
            allowedContentTypes: [.torrentFile],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                Task { await perform { _ = try await appModel.addTorrentFile(url) } }
            case .failure(let error):
                actionError = error.localizedDescription
            }
        }
        .sheet(item: $pendingRemovalTorrent) { torrent in
            RemoveTorrentSheet(
                torrent: torrent,
                onConfirm: { deleteFiles in
                    Task {
                        await perform {
                            _ = try await appModel.dispatch(
                                .removeTorrent(
                                    torrentId: torrent.id,
                                    data: deleteFiles ? .deleteData : .keep
                                )
                            )
                        }
                    }
                    pendingRemovalTorrent = nil
                },
                onCancel: { pendingRemovalTorrent = nil }
            )
        }
    }

    private func toggle(_ torrent: TorrentListItem) {
        Task {
            await perform {
                _ = try await appModel.dispatch(
                    torrent.isStopped
                        ? .resume(torrentId: torrent.id)
                        : .pause(torrentId: torrent.id)
                )
            }
        }
    }

    private func addMagnet() {
        let magnet = magnetInput.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            await perform {
                _ = try await appModel.addMagnet(magnet)
                magnetInput = ""
            }
        }
    }

    @MainActor
    private func perform(_ operation: @escaping () async throws -> Void) async {
        do {
            try await operation()
            actionError = nil
        } catch {
            actionError = error.localizedDescription
        }
    }
}

private struct AppTopBar: View {
    let onOpenSettings: () -> Void
    let onAddTorrent: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image("HeaderAppIcon")
                    .resizable()
                    .scaledToFit()
                    .accessibilityHidden(true)
                    .frame(width: 40, height: 40)
                Text(String(localized: "app_name"))
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("product-name")
            Spacer(minLength: 12)
            HStack(spacing: 12) {
                Button(action: onOpenSettings) { Image(systemName: "gearshape") }
                    .accessibilityLabel(String(localized: "settings_title"))
                    .accessibilityIdentifier("open-settings")
                Button(action: onAddTorrent) { Image(systemName: "plus") }
                    .accessibilityLabel(String(localized: "torrent_list_add_torrent"))
                    .accessibilityIdentifier("add-torrent")
            }
            .font(.title2)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: Capsule(style: .continuous))
        }
    }
}

private struct FilterBar: View {
    @Binding var selectedFilter: TorrentListFilter
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TorrentListFilter.allCases) { filter in
                    Button { selectedFilter = filter } label: {
                        Text(filter.title)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule(style: .continuous).fill(
                                    filter == selectedFilter
                                        ? Color.accentColor : Color(.secondarySystemFill)
                                )
                            )
                            .foregroundStyle(filter == selectedFilter ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
    }
}

private struct RuntimeSummaryCard: View {
    let status: String
    let torrentCount: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(localized: "ios_runtime_section_title")).font(.headline)
            HStack(spacing: 12) {
                RuntimeMetricPill(
                    title: String(localized: "ios_runtime_status_label"),
                    value: status
                )
                RuntimeMetricPill(
                    title: String(localized: "ios_runtime_torrents_label"),
                    value: torrentCount.formatted()
                )
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}

private struct RuntimeMetricPill: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.body.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(.systemBackground))
        )
    }
}

private struct EmptyTorrentState: View {
    let filter: TorrentListFilter
    var body: some View {
        VStack(spacing: 6) {
            Text(filter.emptyTitle)
                .font(.headline)
                .accessibilityIdentifier("torrent-list-empty")
            Text(filter.emptyHint)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

private extension UTType {
    static let torrentFile = UTType(importedAs: "org.bittorrent.torrent")
}
