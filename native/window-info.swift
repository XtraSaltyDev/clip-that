import CoreGraphics
import Foundation

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
