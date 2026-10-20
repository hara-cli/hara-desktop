import AppKit
import Foundation
import CoreGraphics
guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleIdentifier == "com.nanhara.hara.redesign-candidate",
      app.executableURL?.path == CommandLine.arguments[2],
      CommandLine.arguments[2].hasPrefix("/private/tmp/hara-redesign-native-20261020/cargo-target/"),
      CommandLine.arguments[2].hasSuffix("/bundle/macos/Hara Redesign Candidate.app/Contents/MacOS/hara-desktop") else { exit(2) }
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let all = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let prompt = all.contains { ($0[kCGWindowOwnerName as String] as? String) == "SecurityAgent" && ($0[kCGWindowIsOnscreen as String] as? Bool) == true && ($0[kCGWindowLayer as String] as? Int) == 0 }
let windows: [[String: Any]] = all.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }.map { row in
  ["windowId":row[kCGWindowNumber as String] ?? 0,"layer":row[kCGWindowLayer as String] ?? 0,"onscreen":row[kCGWindowIsOnscreen as String] ?? false,"bounds":row[kCGWindowBounds as String] ?? [:]]
}
let result: [String: Any] = ["sessionAvailable":session != nil,"screenLocked":(session?["CGSSessionScreenIsLocked"] as? Bool) ?? (session == nil),"keychainPromptVisible":prompt,"candidatePid":pid,"windows":windows]
print(String(data:try JSONSerialization.data(withJSONObject:result,options:.sortedKeys),encoding:.utf8)!)
