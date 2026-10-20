import AppKit
import Foundation
guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleIdentifier == "com.nanhara.hara.redesign-candidate",
      app.executableURL?.path == CommandLine.arguments[2],
      CommandLine.arguments[2].hasPrefix("/private/tmp/hara-redesign-native-20261020/cargo-target/"),
      CommandLine.arguments[2].hasSuffix("/bundle/macos/Hara Redesign Candidate.app/Contents/MacOS/hara-desktop") else { exit(2) }
exit(app.terminate() ? 0 : 1)
