// Independent test observer: no input injection or application activation.
import AppKit
import CoreGraphics
import Foundation

let watched = ProcessInfo.processInfo.environment["JSTORRENT_UPDATE_TEST_IDENTIFIER"] ?? "com.jstorrent.qualification.update"
let deadline = Double(CommandLine.arguments.dropFirst().first ?? "1200") ?? 1200
let criticalMarker = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
func write(_ record: [String: Any]) {
    var value = record
    value["at"] = ProcessInfo.processInfo.systemUptime
    value["critical"] = criticalMarker.map { FileManager.default.fileExists(atPath: $0) } ?? true
    if let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    }
}
func focus(_ app: NSRunningApplication?) {
    write(["kind": "focus", "watched": app?.bundleIdentifier == watched,
           "pid": Int(app?.processIdentifier ?? 0)])
}
let center = NSWorkspace.shared.notificationCenter
let observer = center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
    focus(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
}
focus(NSWorkspace.shared.frontmostApplication)
var previous = Set<Int>()
let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
    let pids = Set(NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == watched }.map { Int($0.processIdentifier) })
    let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { row in
        pids.contains(row[kCGWindowOwnerPID as String] as? Int ?? 0) && (row[kCGWindowLayer as String] as? Int ?? -1) == 0
    }
    let ids = Set(windows.compactMap { $0[kCGWindowNumber as String] as? Int })
    if ids != previous { previous = ids; write(["kind": "visibility", "windows": ids.sorted()]) }
}
Timer.scheduledTimer(withTimeInterval: deadline, repeats: false) { _ in
    write(["kind": "finished"])
    CFRunLoopStop(CFRunLoopGetMain())
}
write(["kind": "ready", "visibilitySampleMillis": 20])
RunLoop.main.run()
center.removeObserver(observer)
timer.invalidate()
