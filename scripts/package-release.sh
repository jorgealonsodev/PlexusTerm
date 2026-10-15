#!/usr/bin/env bash
# Builds the Linux release assets for one architecture and writes them to
# dist-release/ with the release naming convention:
#   oxyterm_<version>_linux_<arch>.deb
#   oxyterm_<version>_linux_<rpmarch>.rpm
#   oxyterm_<version>_linux_<arch>.tar.gz
# The build is native: <arch> must match the machine running the script.
# Usage: scripts/package-release.sh <version> <amd64|arm64>
set -euo pipefail

usage() {
  echo "Usage: $0 <version> <amd64|arm64>" >&2
  exit 2
}

die() {
  echo "error: $*" >&2
  exit 1
}

[ "$#" -eq 2 ] || usage
VERSION="$1"
ARCH="$2"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+-][0-9A-Za-z.+-]*)?$ ]] \
  || die "invalid version '$VERSION' (expected e.g. 1.2.0, without a leading 'v')"

case "$ARCH" in
  amd64) RPM_ARCH="x86_64" ;;
  arm64) RPM_ARCH="aarch64" ;;
  *) die "unsupported architecture '$ARCH' (expected amd64 or arm64)" ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The tag version must match every version field of the project.
TAURI_VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' src-tauri/tauri.conf.json | head -n 1)"
CARGO_VERSION="$(sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml | head -n 1)"
PACKAGE_VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -n 1)"
mismatch=0
for entry in "src-tauri/tauri.conf.json:$TAURI_VERSION" \
  "src-tauri/Cargo.toml:$CARGO_VERSION" \
  "package.json:$PACKAGE_VERSION"; do
  file="${entry%%:*}"
  found="${entry#*:}"
  if [ "$found" != "$VERSION" ]; then
    echo "error: $file has version '${found:-<not found>}', expected '$VERSION'" >&2
    mismatch=1
  fi
done
[ "$mismatch" -eq 0 ] || die "version mismatch: bump all three version fields to $VERSION before releasing"

case "$(uname -m)" in
  x86_64) HOST_ARCH="amd64" ;;
  aarch64 | arm64) HOST_ARCH="arm64" ;;
  *) HOST_ARCH="$(uname -m)" ;;
esac
[ "$HOST_ARCH" = "$ARCH" ] \
  || die "requested $ARCH but this machine is $HOST_ARCH (packages are built natively)"

command -v dpkg-deb >/dev/null || die "dpkg-deb is required"

BUNDLE="src-tauri/target/release/bundle"
# Remove previous bundles so only this build's packages are picked up.
rm -rf "$BUNDLE/deb" "$BUNDLE/rpm"

pnpm tauri build --bundles deb,rpm

# Returns the single file matching a glob, or fails.
single() {
  local matches=()
  local f
  for f in "$@"; do
    [ -e "$f" ] && matches+=("$f")
  done
  [ "${#matches[@]}" -eq 1 ] || die "expected exactly one file matching '$*', found ${#matches[@]}"
  printf '%s\n' "${matches[0]}"
}

DEB_SRC="$(single "$BUNDLE"/deb/*_"$VERSION"_"$ARCH".deb)"
RPM_SRC="$(single "$BUNDLE"/rpm/*-"$VERSION"-*."$RPM_ARCH".rpm)"

OUT="$ROOT/dist-release"
NAME="oxyterm_${VERSION}_linux_${ARCH}"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.deb" "$OUT/oxyterm_${VERSION}_linux_${RPM_ARCH}.rpm" "$OUT/$NAME.tar.gz"
cp "$DEB_SRC" "$OUT/$NAME.deb"
cp "$RPM_SRC" "$OUT/oxyterm_${VERSION}_linux_${RPM_ARCH}.rpm"

# Portable tarball: binary and desktop entry taken from the .deb so all three
# assets ship identical files.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
dpkg-deb -x "$DEB_SRC" "$WORK/deb"
STAGE="$WORK/$NAME"
mkdir -p "$STAGE"
install -m 0755 "$WORK/deb/usr/bin/oxyterm" "$STAGE/oxyterm"
install -m 0644 "$(single "$WORK"/deb/usr/share/applications/*.desktop)" "$STAGE/oxyterm.desktop"
install -m 0644 README.md "$STAGE/README.md"
for size in 32 64 128; do
  install -D -m 0644 "src-tauri/icons/${size}x${size}.png" "$STAGE/icons/hicolor/${size}x${size}/apps/oxyterm.png"
done
install -D -m 0644 "src-tauri/icons/128x128@2x.png" "$STAGE/icons/hicolor/256x256/apps/oxyterm.png"
install -D -m 0644 "src-tauri/icons/icon.png" "$STAGE/icons/hicolor/512x512/apps/oxyterm.png"

cat >"$STAGE/install.sh" <<'INSTALL'
#!/usr/bin/env bash
# Installs OxyTerm for the current user under ~/.local (no root needed).
# Usage: ./install.sh [--uninstall | --help]
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$DATA/applications"
ICON_DIR="$DATA/icons/hicolor"
SIZES="32x32 64x64 128x128 256x256 512x512"

refresh_caches() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t "$ICON_DIR" >/dev/null 2>&1 || true
  fi
}

install_app() {
  install -D -m 0755 "$SRC/oxyterm" "$BIN_DIR/oxyterm"
  mkdir -p "$APP_DIR"
  # Absolute Exec path: ~/.local/bin is not always on PATH for the desktop session.
  sed "s|^Exec=.*|Exec=\"$BIN_DIR/oxyterm\"|" "$SRC/oxyterm.desktop" >"$APP_DIR/oxyterm.desktop"
  chmod 0644 "$APP_DIR/oxyterm.desktop"
  for size in $SIZES; do
    install -D -m 0644 "$SRC/icons/hicolor/$size/apps/oxyterm.png" "$ICON_DIR/$size/apps/oxyterm.png"
  done
  refresh_caches
  echo "Installed OxyTerm to $BIN_DIR/oxyterm"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Note: $BIN_DIR is not on your PATH; the desktop entry still works." ;;
  esac
}

uninstall_app() {
  rm -f "$BIN_DIR/oxyterm" "$APP_DIR/oxyterm.desktop"
  for size in $SIZES; do
    rm -f "$ICON_DIR/$size/apps/oxyterm.png"
  done
  refresh_caches
  echo "Uninstalled OxyTerm (saved sessions and settings were kept)"
}

case "${1:-}" in
  "") install_app ;;
  --uninstall) uninstall_app ;;
  -h | --help)
    echo "Usage: $0 [--uninstall]"
    echo "Installs OxyTerm into \$HOME/.local/bin, \$HOME/.local/share/applications and"
    echo "\$HOME/.local/share/icons/hicolor; --uninstall removes those files."
    ;;
  *)
    echo "Unknown option: $1 (use --help)" >&2
    exit 2
    ;;
esac
INSTALL
chmod 0755 "$STAGE/install.sh"

tar -C "$WORK" --owner=0 --group=0 --numeric-owner -czf "$OUT/$NAME.tar.gz" "$NAME"

echo "Release assets in $OUT:"
ls -l "$OUT/$NAME.deb" "$OUT/oxyterm_${VERSION}_linux_${RPM_ARCH}.rpm" "$OUT/$NAME.tar.gz"
