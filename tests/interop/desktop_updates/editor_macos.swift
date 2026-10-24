// Owned independent keyboard oracle. Never activates itself after setup.
import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else { exit(2) }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".jstorrent-update-test").path) else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 700, height: 420),
                      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
window.title = "JSTorrent update keyboard oracle"
let scroll = NSScrollView(frame: window.contentView!.bounds)
scroll.autoresizingMask = [.width, .height]
scroll.hasVerticalScroller = true
let text = NSTextView(frame: scroll.bounds)
text.isRichText = false
text.setAccessibilityIdentifier("update-keyboard-oracle")
scroll.documentView = text
window.contentView!.addSubview(scroll)
window.makeKeyAndOrderFront(nil)
window.makeFirstResponder(text)
app.activate(ignoringOtherApps: true)
func write(_ name: String, _ value: String) {
    try? value.write(to: root.appendingPathComponent(name), atomically: true, encoding: .utf8)
}
write("editor.pid", String(ProcessInfo.processInfo.processIdentifier))
var previous = ProcessInfo.processInfo.systemUptime
var maxGap = 0.0
let timer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: true) { _ in
    let now = ProcessInfo.processInfo.systemUptime
    maxGap = max(maxGap, now - previous)
    previous = now
    write("editor.txt", text.string)
    if let data = try? JSONSerialization.data(withJSONObject: ["active": app.isActive, "maxSampleGap": maxGap]) {
        write("editor-state.json", String(decoding: data, as: UTF8.self))
    }
    if FileManager.default.fileExists(atPath: root.appendingPathComponent("stop").path) { app.terminate(nil) }
}
app.run()
timer.invalidate()
