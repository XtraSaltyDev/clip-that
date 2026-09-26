import AppKit
import CoreGraphics
import Foundation

func windowResult(_ row: [String: Any]) -> [String: Any]? {
  guard let rawBounds = row[kCGWindowBounds as String] as? [String: Any],
        let x = rawBounds["X"] as? NSNumber,
        let y = rawBounds["Y"] as? NSNumber,
        let width = rawBounds["Width"] as? NSNumber,
        let height = rawBounds["Height"] as? NSNumber,
        width.doubleValue > 0,
        height.doubleValue > 0 else {
    return nil
  }

  return [
    "id": row[kCGWindowNumber as String] as? NSNumber ?? 0,
    "x": x.doubleValue,
    "y": y.doubleValue,
    "width": width.doubleValue,
    "height": height.doubleValue,
    "owner": row[kCGWindowOwnerName as String] as? String ?? "",
    "title": row[kCGWindowName as String] as? String ?? "",
    "onScreen": row[kCGWindowIsOnscreen as String] as? Bool ?? false
  ]
}

guard CommandLine.arguments.count >= 2 else {
  exit(2)
}

let argument = CommandLine.arguments[1]
if argument == "--watch-scenes" {
  guard CommandLine.arguments.count <= 3 else {
    exit(2)
  }
  let center = NSWorkspace.shared.notificationCenter
  let clipThatName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "ClipThat"
  let emitSceneChange = {
    FileHandle.standardOutput.write(Data("scene-changed\n".utf8))
  }
  let spaceObserver = center.addObserver(
    forName: NSWorkspace.activeSpaceDidChangeNotification,
    object: nil,
    queue: .main
  ) { _ in
    emitSceneChange()
  }
  let applicationObserver = center.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
  ) { notification in
    let activated = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    guard activated?.localizedName != clipThatName else { return }
    emitSceneChange()
  }
  FileHandle.standardOutput.write(Data("ready\n".utf8))
  RunLoop.main.run()
  center.removeObserver(spaceObserver)
  center.removeObserver(applicationObserver)
  exit(0)
}

guard CommandLine.arguments.count == 2 else {
  exit(2)
}

if argument == "--list" {
  let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
  let rows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
  let results = rows.compactMap { row -> [String: Any]? in
    let layer = (row[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
    return layer == 0 ? windowResult(row) : nil
  }
  let data = try JSONSerialization.data(withJSONObject: results)
  FileHandle.standardOutput.write(data)
  exit(0)
}

guard let rawID = UInt32(argument) else {
  exit(2)
}

let options: CGWindowListOption = [.optionIncludingWindow, .excludeDesktopElements]
guard let rows = CGWindowListCopyWindowInfo(options, CGWindowID(rawID)) as? [[String: Any]],
      let result = rows.first.flatMap(windowResult) else {
  exit(3)
}

let data = try JSONSerialization.data(withJSONObject: result)
FileHandle.standardOutput.write(data)
