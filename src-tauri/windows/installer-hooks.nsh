; The Hara task engine is a detached sidecar, so Tauri's default main-executable check cannot see it.
; Windows refuses to replace or remove a running executable. Reuse Tauri's own current-user-aware,
; localized process gate: interactive installers ask before closing it and silent updaters close it
; automatically or abort rather than reporting success with a stale hara.exe.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "hara.exe" "Hara task engine"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "hara.exe" "Hara task engine"
!macroend
