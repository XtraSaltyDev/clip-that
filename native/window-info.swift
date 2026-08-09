import AppKit
import CoreGraphics
import Foundation

final class ScrollSentinelView: NSView {
  var scrollOffset: CGFloat = 0 {
    didSet { needsDisplay = true }
  }

  override var isFlipped: Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let rowHeight: CGFloat = 60
    let firstRow = max(0, Int(floor(scrollOffset / rowHeight)))
    let lastRow = firstRow + Int(ceil(bounds.height / rowHeight)) + 2
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.monospacedSystemFont(ofSize: 24, weight: .bold),
      .foregroundColor: NSColor.white
    ]

    for row in firstRow...lastRow {
      let y = CGFloat(row) * rowHeight - scrollOffset
      let hue = CGFloat((row * 47) % 360) / 360
      NSColor(calibratedHue: hue, saturation: 0.72, brightness: 0.72, alpha: 1).setFill()
      NSBezierPath.fill(NSRect(x: 0, y: y, width: bounds.width, height: rowHeight))
      NSString(format: "ROW %03d - clipthat scroll self test", row).draw(
        at: NSPoint(x: 24, y: y + 15),
        withAttributes: attributes
      )
    }
  }
}

func writeStdout(_ line: String) {
  FileHandle.standardOutput.write(Data("\(line)\n".utf8))
}

if CommandLine.arguments.count == 6,
   CommandLine.arguments[1] == "--scroll-sentinel",
   let x = Double(CommandLine.arguments[2]),
   let y = Double(CommandLine.arguments[3]),
   let width = Double(CommandLine.arguments[4]),
   let height = Double(CommandLine.arguments[5]),
   width > 0,
   height > 0 {
  let application = NSApplication.shared
  application.setActivationPolicy(.accessory)

  // Electron and CoreGraphics use a top-left origin. AppKit uses a bottom-left origin;
  // the self-test deliberately places this fixture on the primary display.
  let primaryHeight = NSScreen.screens.first(where: {
    $0.frame.origin.x == 0 && $0.frame.origin.y == 0
  })?.frame.height ?? NSScreen.main?.frame.height ?? 0
  let contentRect = NSRect(x: x, y: primaryHeight - y - height, width: width, height: height)
  let view = ScrollSentinelView(frame: NSRect(origin: .zero, size: contentRect.size))
  let window = NSWindow(
    contentRect: contentRect,
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
  )
  window.title = "ClipThat external scroll sentinel"
  window.backgroundColor = .black
  window.contentView = view
  window.level = .normal
  window.collectionBehavior = [.moveToActiveSpace]
  window.makeKeyAndOrderFront(nil)
  NSRunningApplication.current.activate(options: [.activateAllWindows])

  var inputBuffer = Data()
  FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    if data.isEmpty {
      DispatchQueue.main.async { application.terminate(nil) }
      return
    }
    inputBuffer.append(data)
    while let newline = inputBuffer.firstIndex(of: 10) {
      let line = String(decoding: inputBuffer[..<newline], as: UTF8.self)
      inputBuffer.removeSubrange(...newline)
      DispatchQueue.main.async {
        if line == "QUIT" {
          application.terminate(nil)
        } else if let offset = Double(line), offset >= 0 {
          view.scrollOffset = CGFloat(offset)
          window.displayIfNeeded()
          writeStdout("SCROLLED \(Int(offset))")
        }
      }
    }
  }

  DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
    writeStdout("READY \(Int(x)) \(Int(y)) \(Int(width)) \(Int(height))")
  }
  application.run()
  exit(0)
}

if CommandLine.arguments.count == 4,
   CommandLine.arguments[1] == "--move-cursor",
   let x = Double(CommandLine.arguments[2]),
   let y = Double(CommandLine.arguments[3]) {
  CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
  exit(0)
}

guard CommandLine.arguments.count == 2,
      let rawID = UInt32(CommandLine.arguments[1]) else {
  exit(2)
}

let options: CGWindowListOption = [.optionIncludingWindow, .excludeDesktopElements]
guard let rows = CGWindowListCopyWindowInfo(options, CGWindowID(rawID)) as? [[String: Any]],
      let row = rows.first,
      let rawBounds = row[kCGWindowBounds as String] as? [String: Any],
      let x = rawBounds["X"] as? NSNumber,
      let y = rawBounds["Y"] as? NSNumber,
      let width = rawBounds["Width"] as? NSNumber,
      let height = rawBounds["Height"] as? NSNumber,
      width.doubleValue > 0,
      height.doubleValue > 0 else {
  exit(3)
}

let result: [String: Any] = [
  "x": x.doubleValue,
  "y": y.doubleValue,
  "width": width.doubleValue,
  "height": height.doubleValue,
  "owner": row[kCGWindowOwnerName as String] as? String ?? "",
  "title": row[kCGWindowName as String] as? String ?? ""
]

let data = try JSONSerialization.data(withJSONObject: result)
FileHandle.standardOutput.write(data)
