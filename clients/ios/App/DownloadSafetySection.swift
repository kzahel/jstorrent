import RSTorrentSession
import SwiftUI

private let recommendedSafetyExtensions = ".exe .com .scr .msi .msix .bat .cmd .ps1 .vbs .js .jse .wsf .hta .lnk .url .dmg .pkg .app .command .sh .apk .appimage .deb .rpm .jar .desktop"
private let archiveSafetyExtensions = ".zip .rar .7z .tar .gz .bz2 .xz .tgz"

func safetyPresetLabel(_ preset: FileSafetyPreset) -> String {
    switch preset {
    case .recommended: return String(localized: "safety_recommended")
    case .archives: return String(localized: "safety_archives")
    case .custom: return String(localized: "safety_custom")
    }
}

struct DownloadSafetySection: View {
    let settings: FileSafetySettings
    @ObservedObject var appModel: AppModel
    @State private var base: FileSafetySettings
    @State private var draft: FileSafetySettings
    @State private var extensions: String
    @State private var pending = false
    @State private var failure: String?

    init(settings: FileSafetySettings, appModel: AppModel) {
        self.settings = settings
        self.appModel = appModel
        _base = State(initialValue: settings)
        _draft = State(initialValue: settings)
        _extensions = State(initialValue: settings.customExtensions.joined(separator: ", "))
    }

    private var parsedExtensions: [String] {
        extensions.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" }).map { $0.lowercased() }
    }

    private var valid: Bool {
        parsedExtensions.count <= 128 && parsedExtensions.allSatisfy {
            $0.utf8.count <= 32 && $0.range(of: #"^\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*$"#, options: .regularExpression) != nil
        }
    }

    private var conflict: Bool { settings != base && settings != draft }

    var body: some View {
        Section(header: Text(String(localized: "safety_title")), footer: Text(String(localized: "safety_future"))) {
            Toggle(String(localized: "safety_enabled"), isOn: $draft.enabled).disabled(pending)
            Picker(String(localized: "safety_files_to_skip"), selection: Binding(get: { draft.preset }, set: { preset in
                if preset == .custom && draft.preset != .custom {
                    extensions = recommendedSafetyExtensions + (draft.preset == .archives ? " " + archiveSafetyExtensions : "")
                    draft.customExtensions = parsedExtensions
                }
                draft.preset = preset
            })) {
                Text(safetyPresetLabel(.recommended)).tag(FileSafetyPreset.recommended)
                Text(safetyPresetLabel(.archives)).tag(FileSafetyPreset.archives)
                Text(safetyPresetLabel(.custom)).tag(FileSafetyPreset.custom)
            }.disabled(!draft.enabled || pending)
            if draft.preset == .custom {
                Text(String(localized: "safety_extensions"))
                TextEditor(text: $extensions).frame(minHeight: 90).autocorrectionDisabled()
                    .textInputAutocapitalization(.never).disabled(!draft.enabled || pending)
                    .onChange(of: extensions) { value in
                        if value.count > 4224 { extensions = String(value.prefix(4224)) }
                        draft.customExtensions = parsedExtensions
                    }
                Text(String(localized: "safety_extensions_help")).font(.caption).foregroundStyle(.secondary)
            }
            if !valid { Text(String(localized: "safety_invalid")).foregroundStyle(.red) }
            if conflict { Text(String(localized: "safety_conflict")).foregroundStyle(.red) }
            if let failure { Text(failure).foregroundStyle(.red) }
            Button(String(localized: "safety_save")) {
                var submitted = draft
                submitted.customExtensions = parsedExtensions
                draft = submitted
                pending = true
                failure = nil
                Task {
                    do { try await appModel.updateFileSafety(submitted, expected: base) }
                    catch { pending = false; failure = error.localizedDescription }
                }
            }.disabled(!valid || conflict || pending || draft == base || appModel.isBusy)
            Button(String(localized: "safety_discard")) {
                base = settings; draft = settings
                extensions = settings.customExtensions.joined(separator: ", ")
                pending = false; failure = nil
            }
        }.onChange(of: settings) { value in
            if draft == base || value == draft {
                base = value; draft = value
                extensions = value.customExtensions.joined(separator: ", ")
            }
            pending = false
        }
    }
}
