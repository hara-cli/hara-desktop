# BASH_ENV is scoped to one Tauri packaging child, not the user's shell configuration.
# macOS Bash 3.2 sets $0/arguments AFTER reading BASH_ENV. Inspect once before the first
# actual script command, then remove the trap even when this is an unrelated shell child.
function __hara_dmg_first_command() {
  trap - DEBUG
  case "$0" in
    */bundle/dmg/bundle_dmg.sh)
      exec "$HARA_DMG_WRAPPER_NODE" "$HARA_DMG_WRAPPER_MODULE" script "$0" "$@"
      ;;
    *) : ;;
  esac
}
trap '__hara_dmg_first_command "$@"' DEBUG
