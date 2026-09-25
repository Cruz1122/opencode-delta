#!/bin/sh
set -eu

PRODUCT="OpenCode Delta"
REPOSITORY="${OPENCODE_DELTA_REPOSITORY:-Cruz1122/opencode-delta}"
BASE_URL="${OPENCODE_DELTA_RELEASE_BASE_URL:-https://github.com/${REPOSITORY}/releases/latest/download}"
VERSION="${OPENCODE_DELTA_VERSION:-}"
INSTALL_DIR="${OPENCODE_DELTA_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-delta"
BACKUP_DIR="$STATE_DIR/backups/$(date +%Y%m%d-%H%M%S)-$$"
TEMP_DIR="${TMPDIR:-/tmp}/opencode-delta-install-$$"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' was not found"
}

need curl
need tar
mkdir -p "$TEMP_DIR" "$BACKUP_DIR"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

baseline="false"
musl="false"
if [ "$os" = "linux" ]; then
  if [ -f /etc/alpine-release ] || (command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl); then
    musl="true"
  fi
  if [ "$arch" = "x64" ]; then
    if [ -r /proc/cpuinfo ]; then
      grep -qE '(^|[[:space:]])avx2([[:space:]]|$)' /proc/cpuinfo || baseline="true"
    else
      baseline="true"
    fi
  fi
else
  if [ "$arch" = "x64" ] && command -v sysctl >/dev/null 2>&1; then
    [ "$(sysctl -n hw.optional.avx2_0 2>/dev/null || printf '0')" = "1" ] || baseline="true"
  fi
fi

target="${os}-${arch}"
[ "$baseline" = "true" ] && target="${target}-baseline"
[ "$musl" = "true" ] && target="${target}-musl"
archive="opencode-delta-${target}.tar.gz"

release_base="$BASE_URL"
if [ -n "$VERSION" ]; then
  release_base="${OPENCODE_DELTA_RELEASE_ROOT_URL:-https://github.com/${REPOSITORY}/releases/download}/delta-v${VERSION}"
fi
archive_url="$release_base/$archive"
checksum_url="$archive_url.sha256"

printf '%s\n' "==> Installing $PRODUCT ($target)"
printf '%s\n' "==> Downloading $archive"
curl --fail --location --retry 3 --retry-delay 2 --silent --show-error "$archive_url" -o "$TEMP_DIR/$archive" || fail "could not download $archive_url"
curl --fail --location --retry 3 --retry-delay 2 --silent --show-error "$checksum_url" -o "$TEMP_DIR/$archive.sha256" || fail "could not download checksum"

expected="$(awk '{print $1}' "$TEMP_DIR/$archive.sha256")"
[ "$(printf '%s' "$expected" | wc -c | tr -d ' ')" -eq 64 ] || fail "invalid checksum file"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TEMP_DIR/$archive" | awk '{print $1}')"
else
  need shasum
  actual="$(shasum -a 256 "$TEMP_DIR/$archive" | awk '{print $1}')"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $archive"

mkdir -p "$TEMP_DIR/package"
tar -tzf "$TEMP_DIR/$archive" > "$TEMP_DIR/archive.paths" || fail "could not inspect release archive"
for entry in $(cat "$TEMP_DIR/archive.paths"); do
  case "$entry" in
    /*|../*|*/../*|..)
      fail "release contains an unsafe archive path: $entry"
      ;;
  esac
done
tar -tvzf "$TEMP_DIR/$archive" > "$TEMP_DIR/archive.types" || fail "could not inspect release entry types"
awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { invalid = 1 } END { exit invalid ? 1 : 0 }' "$TEMP_DIR/archive.types" || fail "release contains a symlink, hardlink, or special file"
tar -xzf "$TEMP_DIR/$archive" -C "$TEMP_DIR/package"
bundle="$TEMP_DIR/package"
binary="$bundle/bin/opencode"
[ -x "$binary" ] || fail "release does not contain executable bin/opencode"
[ -f "$bundle/delta-bundle.json" ] || fail "release does not contain delta-bundle.json"
[ -f "$bundle/suite/opencode/opencode.json" ] || fail "release does not contain the OpenCode suite"
[ -d "$bundle/suite/opencode/skills" ] || fail "release does not contain skills"

config_existed="false"
[ -e "$CONFIG_DIR" ] && config_existed="true"
if [ "$config_existed" = "true" ]; then
  cp -a "$CONFIG_DIR" "$BACKUP_DIR/config"
fi
old_binary="$HOME/.opencode/bin/opencode"
old_binary_existed="false"
if [ -e "$old_binary" ]; then
  old_binary_existed="true"
  mkdir -p "$BACKUP_DIR/old-opencode"
  cp -a "$old_binary" "$BACKUP_DIR/old-opencode/opencode"
fi
target_binary_existed="false"
if [ -e "$INSTALL_DIR/opencode" ]; then
  target_binary_existed="true"
  mkdir -p "$BACKUP_DIR/target-opencode"
  cp -a "$INSTALL_DIR/opencode" "$BACKUP_DIR/target-opencode/opencode"
fi
path_backup_dir="$BACKUP_DIR/path"
mkdir -p "$path_backup_dir"
backup_path_file() {
  file="$1"
  slot="$2"
  if [ -e "$file" ]; then
    cp -a "$file" "$path_backup_dir/$slot"
  else
    : > "$path_backup_dir/$slot.missing"
  fi
}
backup_path_file "$HOME/.profile" profile
backup_path_file "$HOME/.bashrc" bashrc
backup_path_file "$HOME/.zshrc" zshrc
backup_path_file "$HOME/.config/fish/config.fish" fish
committed="false"

rollback() {
  [ "$committed" = "true" ] && return 0
  printf '%s\n' "==> Installation failed; restoring previous state" >&2
  rm -rf "$CONFIG_DIR"
  if [ "$config_existed" = "true" ]; then
    mkdir -p "$(dirname "$CONFIG_DIR")"
    cp -a "$BACKUP_DIR/config" "$CONFIG_DIR"
  fi
  rm -f "$INSTALL_DIR/opencode"
  if [ "$target_binary_existed" = "true" ]; then
    mkdir -p "$INSTALL_DIR"
    cp -a "$BACKUP_DIR/target-opencode/opencode" "$INSTALL_DIR/opencode"
  fi
  restore_path_file() {
    file="$1"
    slot="$2"
    if [ -e "$path_backup_dir/$slot.missing" ]; then
      rm -f "$file"
    else
      mkdir -p "$(dirname "$file")"
      cp -a "$path_backup_dir/$slot" "$file"
    fi
  }
  restore_path_file "$HOME/.profile" profile
  restore_path_file "$HOME/.bashrc" bashrc
  restore_path_file "$HOME/.zshrc" zshrc
  restore_path_file "$HOME/.config/fish/config.fish" fish
  if [ "$old_binary_existed" = "true" ]; then
    mkdir -p "$(dirname "$old_binary")"
    cp -a "$BACKUP_DIR/old-opencode/opencode" "$old_binary"
  fi
}
trap 'rollback; cleanup' EXIT INT TERM

mkdir -p "$CONFIG_DIR" "$INSTALL_DIR"
for directory in agents instructions plugins tools lib brain-templates cursor bin skills; do
  if [ -d "$bundle/suite/opencode/$directory" ]; then
    mkdir -p "$CONFIG_DIR/$directory"
    cp -a "$bundle/suite/opencode/$directory"/. "$CONFIG_DIR/$directory"/
  fi
done
if [ -d "$bundle/suite/opencode/node_modules" ]; then
  mkdir -p "$CONFIG_DIR/node_modules"
  cp -a "$bundle/suite/opencode/node_modules"/. "$CONFIG_DIR/node_modules"/
fi
cp "$bundle/suite/opencode/package.json" "$CONFIG_DIR/package.json"

"$binary" delta install-config \
  --source "$bundle/suite/opencode/opencode.json" \
  --target "$CONFIG_DIR/opencode.json" \
  --agents-source "$bundle/suite/opencode/AGENTS.md" \
  --agents-target "$CONFIG_DIR/AGENTS.md" || fail "Delta configuration merge failed"

new_binary="$INSTALL_DIR/.opencode-delta.$$"
cp "$binary" "$new_binary"
chmod 0755 "$new_binary"
mv -f "$new_binary" "$INSTALL_DIR/opencode"

bundle_version="$(awk -F'"' '/"version"[[:space:]]*:/ {print $4; exit}' "$bundle/delta-bundle.json")"
[ -n "$bundle_version" ] || bundle_version="${VERSION:-unknown}"
cat > "$CONFIG_DIR/delta.json" <<EOF
{
  "product": "opencode-delta",
  "version": "$bundle_version",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "mascot": true,
  "autopilot": true,
  "target": "$target",
  "installDir": "$INSTALL_DIR",
  "backupDir": "$BACKUP_DIR"
}
EOF

add_path() {
  file="$1"
  marker="# OpenCode Delta PATH"
  [ -e "$file" ] || : > "$file"
  if ! grep -Fq "$marker" "$file" 2>/dev/null; then
    printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$INSTALL_DIR" >> "$file"
  fi
}
if [ -e "$old_binary" ] && [ "$old_binary" != "$INSTALL_DIR/opencode" ]; then
  mv "$old_binary" "$BACKUP_DIR/upstream-opencode"
fi

"$INSTALL_DIR/opencode" delta status --json >/dev/null || fail "installed Delta binary failed its status check"
cat > "$STATE_DIR/install.json" <<EOF
{
  "product": "opencode-delta",
  "version": "$bundle_version",
  "target": "$target",
  "installDir": "$INSTALL_DIR",
  "configDir": "$CONFIG_DIR",
  "backupDir": "$BACKUP_DIR",
  "dataPreserved": true
}
EOF

add_path "$HOME/.profile" || fail "could not update $HOME/.profile"
if [ -e "$HOME/.bashrc" ]; then add_path "$HOME/.bashrc" || fail "could not update $HOME/.bashrc"; fi
if [ -e "$HOME/.zshrc" ]; then add_path "$HOME/.zshrc" || fail "could not update $HOME/.zshrc"; fi
if [ -e "$HOME/.config/fish/config.fish" ]; then
  if ! grep -Fq "# OpenCode Delta PATH" "$HOME/.config/fish/config.fish" 2>/dev/null; then
    printf '\n# OpenCode Delta PATH\nfish_add_path --prepend "%s"\n' "$INSTALL_DIR" >> "$HOME/.config/fish/config.fish" || fail "could not update fish PATH"
  fi
fi
committed="true"
printf '\n%s\n' "$PRODUCT installation complete."
printf '%s\n' "Open a new terminal, then run: opencode delta status --json"
printf '%s\n' "Backup: $BACKUP_DIR"
