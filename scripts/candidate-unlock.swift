// Only open/unlock the existing dedicated signing Keychain; never alter global configuration.
import Foundation
import Security
import Darwin
let environment = ProcessInfo.processInfo.environment
guard let keychainPath = environment["HARA_CANDIDATE_SIGNING_KEYCHAIN"],
  let passwordPath = environment["HARA_CANDIDATE_SIGNING_PASSWORD_FILE"],
  keychainPath.hasPrefix("/"), passwordPath.hasPrefix("/"),
  keychainPath.count < 4096, passwordPath.count < 4096,
  keychainPath != passwordPath else { exit(1) }
let fd = open(passwordPath, O_RDONLY | O_NOFOLLOW)
guard fd >= 0 else { exit(1) }
defer { close(fd) }
var metadata = stat()
guard fstat(fd, &metadata) == 0, metadata.st_uid == getuid(), metadata.st_nlink == 1,
  metadata.st_mode & 0o777 == 0o600, metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
  metadata.st_size > 0, metadata.st_size < 1024 else { exit(2) }
var password = [UInt8](repeating: 0, count: Int(metadata.st_size))
guard read(fd, &password, password.count) == password.count else { exit(3) }
while password.last == 10 || password.last == 13 { password.removeLast() }
guard !password.isEmpty else { exit(4) }
var keychain: SecKeychain?
guard SecKeychainOpen(keychainPath, &keychain) == errSecSuccess, let owned = keychain else { exit(5) }
let result = password.withUnsafeBytes { bytes in SecKeychainUnlock(owned, UInt32(bytes.count), bytes.baseAddress, true) }
for index in password.indices { password[index] = 0 }
guard result == errSecSuccess else { exit(6) }
