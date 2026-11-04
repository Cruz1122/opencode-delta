#!/bin/sh
set -eu

REPOSITORY="${OPENCODE_DELTA_REPOSITORY:-Cruz1122/opencode}"
INSTALL_DIR="${OPENCODE_DELTA_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-delta"
ONLY="both"
ACTION="install"
SKIP_CLAUDE="false"
UPDATE_CLAUDE="false"
TEMP_DIR=""
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing; no system packages will be installed."; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) ACTION="check" ;;
    --uninstall) ACTION="uninstall" ;;
    --undo) ACTION="undo" ;;
    --skip-claude-install) SKIP_CLAUDE="true" ;;
    --update-claude) UPDATE_CLAUDE="true" ;;
    --only) shift; ONLY="${1:-}" ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done
case "$ONLY" in opencode|claude|both) ;; *) fail "--only requires opencode, claude, or both" ;; esac
need uname
case "$(uname -s)" in Linux) os="linux" ;; Darwin) os="darwin" ;; *) fail "Unsupported operating system" ;; esac
case "$(uname -m)" in x86_64|amd64) arch="x64" ;; arm64|aarch64) arch="arm64" ;; *) fail "Unsupported architecture" ;; esac

if [ "$ACTION" = "check" ]; then
  need curl; need tar; need mktemp
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail "sha256sum or shasum is required"
  if [ "$ONLY" != "opencode" ] && [ "$SKIP_CLAUDE" != "true" ] && ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then need bash; fi
  printf '%s\n' "Preflight OK (offline): $os-$arch; selection=$ONLY" "User bin: $INSTALL_DIR" "OpenCode config: $CONFIG_DIR" "Claude config: $CLAUDE_DIR" "No administrator privileges or development toolchain required. Network access and executable policy are checked during installation."
  exit 0
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencode-delta.XXXXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$ACTION" != "install" ]; then
  [ -x "$STATE_DIR/maintenance/opencode" ] || fail "No managed installation helper found"
  cp "$STATE_DIR/maintenance/opencode" "$TEMP_DIR/opencode"
  "$TEMP_DIR/opencode" delta profile "$ACTION" --state "$STATE_DIR"
  printf '%s\n' "Managed profile $ACTION complete. Authentication, history, unrelated files and the separately installed Claude executable are preserved. Backups remain in $STATE_DIR."
  exit 0
fi

need curl; need tar
target="$os-$arch"
if [ "$arch" = "x64" ]; then
  if [ "$os" = "linux" ]; then
    if ! grep -qE '(^|[[:space:]])avx2([[:space:]]|$)' /proc/cpuinfo 2>/dev/null; then target="$target-baseline"; fi
  elif [ "$(sysctl -n hw.optional.avx2_0 2>/dev/null || printf '0')" != "1" ]; then target="$target-baseline"; fi
fi
if [ "$os" = "linux" ] && { [ -f /etc/alpine-release ] || (command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl); }; then target="$target-musl"; fi
base="${OPENCODE_DELTA_RELEASE_BASE_URL:-https://github.com/$REPOSITORY/releases/latest/download}"
if [ -n "${OPENCODE_DELTA_VERSION:-}" ]; then
  base="${OPENCODE_DELTA_RELEASE_ROOT_URL:-https://github.com/$REPOSITORY/releases/download}/delta-v$OPENCODE_DELTA_VERSION"
fi
archive="opencode-delta-$target.tar.gz"
printf '%s\n' "==> Downloading $REPOSITORY / $archive"
curl -fLSs --retry 3 "$base/$archive" -o "$TEMP_DIR/package.tar.gz"
curl -fLSs --retry 3 "$base/$archive.sha256" -o "$TEMP_DIR/checksum"
expected="$(awk 'NR == 1 { print $1 }' "$TEMP_DIR/checksum")"
case "$expected" in *[!a-fA-F0-9]*|'') fail "Invalid checksum" ;; esac
[ "${#expected}" -eq 64 ] || fail "Invalid checksum length"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TEMP_DIR/package.tar.gz" | awk '{print $1}')"
else
  need shasum
  actual="$(shasum -a 256 "$TEMP_DIR/package.tar.gz" | awk '{print $1}')"
fi
[ "$expected" = "$actual" ] || fail "Checksum mismatch"
tar -tzf "$TEMP_DIR/package.tar.gz" > "$TEMP_DIR/paths"
while IFS= read -r entry; do
  case "$entry" in /*|../*|*/../*|*/..|..) fail "Unsafe archive path: $entry" ;; esac
done < "$TEMP_DIR/paths"
tar -tvzf "$TEMP_DIR/package.tar.gz" > "$TEMP_DIR/types"
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad ? 1 : 0 }' "$TEMP_DIR/types" || fail "Archive contains links or special files"
mkdir "$TEMP_DIR/package"
tar -xzf "$TEMP_DIR/package.tar.gz" -C "$TEMP_DIR/package"
bundle="$TEMP_DIR/package"
binary="$bundle/bin/opencode"
[ -x "$binary" ] || fail "Release executable is missing"
[ -f "$bundle/delta-bundle.json" ] || fail "Release metadata is missing"
"$binary" --version

if [ "$ONLY" != "opencode" ] && [ "$SKIP_CLAUDE" != "true" ]; then
  if command -v claude >/dev/null 2>&1; then
    if [ "$UPDATE_CLAUDE" = "true" ]; then claude install "${CLAUDE_CODE_VERSION:-stable}"; fi
    claude --version
  elif [ -x "$HOME/.local/bin/claude" ]; then
    if [ "$UPDATE_CLAUDE" = "true" ]; then "$HOME/.local/bin/claude" install "${CLAUDE_CODE_VERSION:-stable}"; fi
    "$HOME/.local/bin/claude" --version
  else
    need bash
    printf '%s\n' '==> Installing Claude Code from Anthropic (separate installer; may leave its own files on failure)'
    curl -fLSs https://claude.ai/install.sh -o "$TEMP_DIR/claude-install.sh"
    DISABLE_AUTOUPDATER=1 bash "$TEMP_DIR/claude-install.sh" "${CLAUDE_CODE_VERSION:-stable}" || fail "Anthropic installer failed; managed profile has not been changed"
    "$HOME/.local/bin/claude" --version
  fi
fi

# Cache a helper even for a Claude-only profile so removal never requires another download.
mkdir -p "$STATE_DIR/maintenance"
cp "$binary" "$STATE_DIR/maintenance/opencode.new"
chmod 0755 "$STATE_DIR/maintenance/opencode.new"
mv -f "$STATE_DIR/maintenance/opencode.new" "$STATE_DIR/maintenance/opencode"
"$binary" delta profile install --bundle "$bundle" --home "$HOME" --config "$CONFIG_DIR" --claude "$CLAUDE_DIR" --bin "$INSTALL_DIR" --state "$STATE_DIR" --only "$ONLY"
printf '%s\n' 'Installation complete. Open a new terminal. Authenticate separately; no credentials were imported.' 'Launch roles in Claude Code with: claude --agent ask (or plan, agent, debug, quality).' 'To update, rerun this installer. To restore the previous generation: sh install.sh --undo' 'To remove all managed generations: sh install.sh --uninstall'
