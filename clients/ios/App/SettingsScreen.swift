import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct SettingsScreen: View {
    @ObservedObject var lifecycle: IOSApplicationLifecycleOwner
    @ObservedObject var appModel: AppModel
    @ObservedObject var presentation: IOSPresentationRepository
    @State private var isPresentingFolderPicker = false
    @State private var repairingRootID: String?

    private var defaultRoot: RootDisplayItem? {
        let id = presentation.storage?.defaultRoot ?? "ios-documents"
        return appModel.roots.first { $0.id == id }
    }

    var body: some View {
        Form {
            Section(
                header: Text(String(localized: "settings_storage_title")),
                footer: Text(String(localized: "settings_download_folder_footer"))
            ) {
                LabeledContent(String(localized: "settings_download_folder_label")) {
                    Text(defaultRoot?.label ?? String(localized: "ios_app_documents"))
                        .multilineTextAlignment(.trailing)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(defaultRoot?.detailText ?? String(localized: "ios_on_my_device"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            Section {
                Button(String(localized: "settings_download_folder_choose_button")) {
                    isPresentingFolderPicker = true
                }
                .accessibilityIdentifier("choose-download-folder")
                .disabled(appModel.isBusy)

                if appModel.roots.count > 1 {
                    Button(
                        String(localized: "settings_download_folder_reset_button"),
                        role: .destructive
                    ) {
                        Task { await appModel.resetExternalFolders() }
                    }
                    .disabled(appModel.isBusy)
                }
            }

            if let settings = presentation.fileSafetySettings {
                DownloadSafetySection(settings: settings, appModel: appModel)
            }

            Section(String(localized: "ios_runtime_section_title")) {
                LabeledContent(
                    String(localized: "ios_runtime_status_label"),
                    value: appModel.engineStatus.text
                )
                ForEach(appModel.roots) { root in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(
                            root.label,
                            systemImage: root.available
                                ? "folder.fill" : "exclamationmark.triangle.fill"
                        )
                        Text(root.detailText).font(.caption).foregroundStyle(.secondary)
                        if !root.available, root.id != "ios-documents" {
                            Button(String(localized: "settings_download_folder_repair_button")) {
                                repairingRootID = root.id
                                isPresentingFolderPicker = true
                            }
                            .accessibilityLabel(
                                String(
                                    format: String(localized: "ios_accessibility_repair_folder"),
                                    locale: .current,
                                    root.label
                                )
                            )
                            .disabled(appModel.isBusy)
                        }
                    }
                    .accessibilityIdentifier("storage-root-\(root.id)")
                }
            }

            Section(
                header: Text(String(localized: "ios_background_section_title")),
                footer: Text(String(localized: "ios_background_footer"))
            ) {
                Toggle(
                    String(localized: "ios_background_notifications_label"),
                    isOn: Binding(
                        get: { lifecycle.notificationsEnabled },
                        set: { enabled in
                            Task { await lifecycle.setNotificationsEnabled(enabled) }
                        }
                    )
                )
                .accessibilityIdentifier("background-notifications")
                Text(lifecycle.backgroundStatus.text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Text(appModel.selectionStatus.text)
                    .foregroundStyle(appModel.selectionStatus.isError ? .red : .secondary)
            }
        }
        .accessibilityIdentifier("settings-screen")
        .navigationTitle(String(localized: "settings_title"))
        .sheet(isPresented: $isPresentingFolderPicker) {
            DownloadFolderPicker(
                isPresented: $isPresentingFolderPicker,
                onPick: { url in
                    let rootID = repairingRootID
                    Task {
                        if let rootID {
                            await appModel.repairFolder(rootID: rootID, with: url)
                        } else {
                            await appModel.selectFolder(url)
                        }
                    }
                }
            )
        }
        .onChange(of: isPresentingFolderPicker) { presented in
            if !presented { repairingRootID = nil }
        }
    }
}

private struct DownloadFolderPicker: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let onPick: (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(isPresented: $isPresented, onPick: onPick)
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.folder],
            asCopy: false
        )
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        @Binding private var isPresented: Bool
        private let onPick: (URL) -> Void

        init(isPresented: Binding<Bool>, onPick: @escaping (URL) -> Void) {
            self._isPresented = isPresented
            self.onPick = onPick
        }

        func documentPicker(
            _ controller: UIDocumentPickerViewController,
            didPickDocumentsAt urls: [URL]
        ) {
            if urls.count == 1, let url = urls.first { onPick(url) }
            isPresented = false
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            isPresented = false
        }
    }
}
