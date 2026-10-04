// AppKit secure fields and inherited-descriptor handoff follow Fidelius's native UX.
// Complete scoped Holocron metadata is visible before explicit approval.
import AppKit
import Foundation

struct Request {
    let recipient: String
    let fingerprint: String
    let requestID: String
    let purpose: String
    let expiry: String
    let names: [String]
    let pairing: Bool
    let macFingerprint: String
    let enrollmentExpiry: String
}
struct Response: Codable {
    let cancelled: Bool
    let values: [String: String]
}
final class Delegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let request: Request
    private var window: NSWindow!
    private var fields: [String: NSSecureTextField] = [:]
    private var finished = false
    init(_ request: Request) { self.request = request; super.init() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let width: CGFloat = 520
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: request.pairing ? "Pair a receiving computer" : "Send API keys to a paired computer")
        title.font = .systemFont(ofSize: 21, weight: .semibold)
        stack.addArrangedSubview(title)
        let details = NSTextView()
        details.isEditable = false
        details.isSelectable = true
        details.drawsBackground = false
        details.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        if request.pairing {
            details.string = "Recipient: \(request.recipient)\nReceiver fingerprint: \(request.fingerprint)\nDescriptor: \(request.requestID)\nRelay: \(request.purpose)\nPairing expires: \(request.expiry)\nEnrollment expires: \(request.enrollmentExpiry)\n\nMac fingerprint: \(request.macFingerprint)\n\nCompare the receiver fingerprint with the intended computer. Approve only that computer. Give the receiver this Mac fingerprint through your authenticated conversation. No key values are sent by pairing."
        } else {
            details.string = "Recipient: \(request.recipient)\nRecipient fingerprint: \(request.fingerprint)\nRequest: \(request.requestID)\nExpires: \(request.expiry)\n\nPurpose: \(request.purpose)\n\nApprove only these named keys for this recipient and purpose.\nRecipient files auto-delete after five minutes."
        }
        details.textContainer?.widthTracksTextView = true
        details.isVerticallyResizable = true
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.documentView = details
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(scroll)
        scroll.widthAnchor.constraint(equalToConstant: width).isActive = true
        scroll.heightAnchor.constraint(equalToConstant: request.pairing ? 330 : 190).isActive = true
        details.frame = NSRect(x: 0, y: 0, width: width - 20, height: 400)
        for name in request.names {
            let row = NSStackView()
            row.orientation = .vertical
            row.alignment = .leading
            row.spacing = 5
            let label = NSTextField(labelWithString: name)
            label.font = .monospacedSystemFont(ofSize: 12, weight: .semibold)
            let field = NSSecureTextField()
            field.placeholderString = "Enter key privately"
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(equalToConstant: width).isActive = true
            fields[name] = field
            row.addArrangedSubview(label)
            row.addArrangedSubview(field)
            stack.addArrangedSubview(row)
        }
        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 10
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelRequest))
        cancel.keyEquivalent = "\u{1b}"
        let approve = NSButton(title: request.pairing ? "Approve pairing" : "Approve and send", target: self, action: #selector(approveRequest))
        approve.bezelStyle = .rounded
        buttons.addArrangedSubview(cancel)
        buttons.addArrangedSubview(approve)
        stack.addArrangedSubview(buttons)
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -24)
        ])
        let contentScroll = NSScrollView()
        contentScroll.hasVerticalScroller = true
        contentScroll.documentView = content
        content.frame = NSRect(x: 0, y: 0, width: width + 48, height: CGFloat((request.pairing ? 480 : 340) + request.names.count * 72))
        let availableHeight = (NSScreen.main?.visibleFrame.height ?? 720) - 80
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width + 48, height: min(availableHeight, content.frame.height)),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = request.pairing ? "Holocron pairing approval" : "Holocron private key request"
        window.contentView = contentScroll
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        if let first = request.names.first { window.makeFirstResponder(fields[first]) }
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func approveRequest() {
        var values: [String: String] = [:]
        for name in request.names {
            guard let value = fields[name]?.stringValue, !value.isEmpty, value.utf8.count <= 4096 else {
                NSSound.beep()
                window.makeFirstResponder(fields[name])
                return
            }
            values[name] = value
        }
        finish(Response(cancelled: false, values: values))
    }
    @objc private func cancelRequest() { finish(Response(cancelled: true, values: [:])) }
    func windowWillClose(_ notification: Notification) { cancelRequest() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !finished { emit(Response(cancelled: true, values: [:])) }
        return .terminateNow
    }
    private func finish(_ response: Response) {
        guard !finished else { return }
        finished = true
        emit(response)
        for field in fields.values { field.stringValue = "" }
        NSApp.terminate(nil)
    }
    private func emit(_ response: Response) {
        guard let data = try? JSONEncoder().encode(response) else { return }
        FileHandle(fileDescriptor: 3, closeOnDealloc: false).write(data)
    }
}
// Arguments are public request metadata only. Secret bytes use inherited FD 3.
let args = Array(CommandLine.arguments.dropFirst())
let request: Request
if args.first == "--pair" {
    guard args.count == 8 else { exit(2) }
    request = Request(recipient: args[1], fingerprint: args[2], requestID: args[3], purpose: args[4], expiry: args[5],
                      names: [], pairing: true, macFingerprint: args[6], enrollmentExpiry: args[7])
} else {
    guard args.count >= 6, args.count <= 13 else { exit(2) }
    request = Request(recipient: args[0], fingerprint: args[1], requestID: args[2], purpose: args[3], expiry: args[4],
                      names: Array(args.dropFirst(5)), pairing: false, macFingerprint: "", enrollmentExpiry: "")
}
let delegate = Delegate(request)
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
