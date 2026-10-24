#!/usr/bin/env bash
# Isolated packaging contract tests; no native build or host installation.
# Optional: --compare <previous-script> checks legacy behavior against a baseline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/package-release.sh"
BASELINE=""
if [ "$#" -ne 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --compare ] || exit 2
  BASELINE="$2"
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "$BASELINE" ]; then
  cp "$BASELINE" "$WORK/baseline.sh"
  BASELINE="$WORK/baseline.sh"
fi
fail() { echo "FAIL: $*" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "missing $1"; }
assert_text() {
  if [ -n "$2" ]; then
    printf '%s\n' "$2" >"$WORK/expected"
  else
    printf '' >"$WORK/expected"
  fi
  cmp -s "$1" "$WORK/expected" || fail "$1: expected '$2', got '$(<"$1")'"
}
fixture() {
  CASE="$WORK/$1"
  mkdir -p "$CASE/scripts" "$CASE/bin" "$CASE/src-tauri/icons"
  cp "$SCRIPT" "$CASE/scripts/package-release.sh"
  printf '  "version": "1.2.0",\n' >"$CASE/package.json"
  cp "$CASE/package.json" "$CASE/src-tauri/tauri.conf.json"
  printf 'version = "1.2.0"\n' >"$CASE/src-tauri/Cargo.toml"
  printf 'fixture readme\n' >"$CASE/README.md"
  for icon in 32x32 64x64 128x128 128x128@2x icon; do
    printf '%s\n' "$icon" >"$CASE/src-tauri/icons/$icon.png"
  done
  cat >"$CASE/bin/uname" <<'DOUBLE'
#!/usr/bin/env bash
printf '%s\n' "$TEST_HOST"
DOUBLE
  cat >"$CASE/bin/pnpm" <<'DOUBLE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >build-call
bundle=src-tauri/target/release/bundle
# The production script must clear old bundle files before invoking the builder.
[ ! -e "$bundle/appimage/stale.AppImage" ] || { echo 'stale AppImage bundle' >&2; exit 9; }
mkdir -p "$bundle/deb" "$bundle/rpm"
printf 'deb payload\n' >"$bundle/deb/PlexusTerm_1.2.0_${TEST_ARCH}.deb"
printf 'rpm payload\n' >"$bundle/rpm/PlexusTerm-1.2.0-1.${TEST_RPM}.rpm"
if [[ "$*" == *appimage* ]]; then
  mkdir -p "$bundle/appimage"
  case "$TEST_IMAGES" in
    one)
      printf 'AppImage payload\n' >"$bundle/appimage/PlexusTerm_1.2.0_${TEST_HOST}.AppImage"
      chmod 0755 "$bundle/appimage/PlexusTerm_1.2.0_${TEST_HOST}.AppImage" ;;
    missing) ;;
    ambiguous)
      touch "$bundle/appimage/first.AppImage" "$bundle/appimage/second.AppImage" ;;
  esac
fi
DOUBLE
  cat >"$CASE/bin/dpkg-deb" <<'DOUBLE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = -x ]
mkdir -p "$3/usr/bin" "$3/usr/share/applications"
printf '#!/bin/sh\necho fixture\n' >"$3/usr/bin/plexusterm"
printf '[Desktop Entry]\nExec=plexusterm\n' >"$3/usr/share/applications/plexusterm.desktop"
DOUBLE
  # Stable listing output allows exact stdout assertions without timestamps.
  cat >"$CASE/bin/ls" <<'DOUBLE'
#!/usr/bin/env bash
[ "$1" = -l ] || exit 8
shift
for file in "$@"; do
  [ -f "$file" ] || exit 8
  printf '%s\n' "${file##*/}"
done
DOUBLE
  chmod +x "$CASE/bin/"*
}
run() {
  local expected="$1"
  shift
  local status=0
  (cd "$CASE" && PATH="$CASE/bin:$PATH" bash scripts/package-release.sh "$@") >"$CASE/stdout" 2>"$CASE/stderr" || status=$?
  [ "$status" -eq "$expected" ] || fail "status $status, expected $expected: $(<"$CASE/stderr")"
}
export TEST_HOST=x86_64 TEST_ARCH=amd64 TEST_RPM=x86_64 TEST_IMAGES=one

# Rejected arguments must never build or change existing output.
for scenario in usage version arch mismatch host; do
  fixture "reject-$scenario"
  mkdir -p "$CASE/dist-release"
  printf 'keep\n' >"$CASE/dist-release/sentinel"
  args=(1.2.0 amd64)
  expected=1
  case "$scenario" in
    usage) args=(); expected=2; error='Usage: scripts/package-release.sh <version> <amd64|arm64>' ;;
    version) args=(v1.2.0 amd64); error="error: invalid version 'v1.2.0' (expected e.g. 1.2.0, without a leading 'v')" ;;
    arch) args=(1.2.0 riscv64); error="error: unsupported architecture 'riscv64' (expected amd64 or arm64)" ;;
    mismatch)
      printf '  "version": "1.1.0",\n' >"$CASE/package.json"
      error="error: package.json has version '1.1.0', expected '1.2.0'
error: version mismatch: bump all three version fields to 1.2.0 before releasing" ;;
    host) args=(1.2.0 arm64); error='error: requested arm64 but this machine is amd64 (packages are built natively)' ;;
  esac
  run "$expected" "${args[@]}"
  assert_text "$CASE/stdout" ''
  assert_text "$CASE/stderr" "$error"
  assert_text "$CASE/dist-release/sentinel" keep
  [ ! -e "$CASE/build-call" ] || fail 'rejected input triggered build'
  [ "$(find "$CASE/dist-release" -type f | wc -l)" -eq 1 ] || fail 'rejected input changed output'
  if [ -n "$BASELINE" ]; then
    cp "$CASE/stdout" "$CASE/previous-stdout"
    cp "$CASE/stderr" "$CASE/previous-stderr"
    cp "$BASELINE" "$CASE/scripts/package-release.sh"
    run "$expected" "${args[@]}"
    cmp "$CASE/stdout" "$CASE/previous-stdout"
    cmp "$CASE/stderr" "$CASE/previous-stderr"
  fi
done

for TEST_ARCH in amd64 arm64; do
  export TEST_ARCH
  if [ "$TEST_ARCH" = amd64 ]; then TEST_HOST=x86_64; TEST_RPM=x86_64; else TEST_HOST=aarch64; TEST_RPM=aarch64; fi
  export TEST_HOST TEST_RPM
  fixture "success-$TEST_ARCH"
  name="plexusterm_1.2.0_linux_$TEST_ARCH"
  rpm="plexusterm_1.2.0_linux_$TEST_RPM.rpm"
  mkdir -p "$CASE/dist-release" "$CASE/src-tauri/target/release/bundle/appimage"
  printf 'stale\n' >"$CASE/src-tauri/target/release/bundle/appimage/stale.AppImage"
  for asset in "$name.deb" "$rpm" "$name.tar.gz" "$name.AppImage"; do
    printf 'stale\n' >"$CASE/dist-release/$asset"
  done
  printf 'keep\n' >"$CASE/dist-release/unrelated"
  run 0 1.2.0 "$TEST_ARCH"
  assert_text "$CASE/build-call" 'tauri build --bundles deb,rpm,appimage'
  assert_text "$CASE/stderr" ''
  assert_text "$CASE/stdout" "Release assets in $CASE/dist-release:
$name.deb
$rpm
$name.tar.gz
$name.AppImage"
  assert_text "$CASE/dist-release/$name.AppImage" 'AppImage payload'
  [ -x "$CASE/dist-release/$name.AppImage" ] || fail 'AppImage lost executable mode'
  assert_text "$CASE/dist-release/$name.deb" 'deb payload'
  assert_text "$CASE/dist-release/$rpm" 'rpm payload'
  assert_text "$CASE/dist-release/unrelated" keep
  mkdir "$CASE/extracted"
  tar -xzf "$CASE/dist-release/$name.tar.gz" -C "$CASE/extracted"
  stage="$CASE/extracted/$name"
  assert_text "$stage/plexusterm" $'#!/bin/sh\necho fixture'
  assert_text "$stage/plexusterm.desktop" $'[Desktop Entry]\nExec=plexusterm'
  assert_text "$stage/README.md" 'fixture readme'
  for size in 32 64 128 256 512; do
    assert_file "$stage/icons/hicolor/${size}x${size}/apps/plexusterm.png"
  done
  [ -x "$stage/plexusterm" ] && [ -x "$stage/install.sh" ] || fail 'portable executables lost mode'
  bash -n "$stage/install.sh"
  [ "$(find "$stage" -type f | wc -l)" -eq 9 ] || fail 'portable contents changed'
  if [ -n "$BASELINE" ]; then
    cp "$CASE/stdout" "$CASE/current-stdout"
    cp "$BASELINE" "$CASE/scripts/package-release.sh"
    run 0 1.2.0 "$TEST_ARCH"
    assert_text "$CASE/build-call" 'tauri build --bundles deb,rpm'
    assert_text "$CASE/stderr" ''
    # Only the requested additional asset listing differs.
    head -n -1 "$CASE/current-stdout" >"$CASE/legacy-stdout"
    cmp "$CASE/stdout" "$CASE/legacy-stdout"
    assert_text "$CASE/dist-release/$name.deb" 'deb payload'
    assert_text "$CASE/dist-release/$rpm" 'rpm payload'
    mkdir "$CASE/baseline-extracted"
    tar -xzf "$CASE/dist-release/$name.tar.gz" -C "$CASE/baseline-extracted"
    diff -r "$CASE/extracted" "$CASE/baseline-extracted"
  fi
done

for TEST_IMAGES in missing ambiguous; do
  export TEST_IMAGES
  fixture "$TEST_IMAGES"
  mkdir "$CASE/dist-release"
  for asset in "$name.deb" "$rpm" "$name.tar.gz" "$name.AppImage"; do
    printf 'keep\n' >"$CASE/dist-release/$asset"
  done
  run 1 1.2.0 "$TEST_ARCH"
  pattern='src-tauri/target/release/bundle/appimage/*.AppImage'
  count=0
  if [ "$TEST_IMAGES" = ambiguous ]; then
    pattern='src-tauri/target/release/bundle/appimage/first.AppImage src-tauri/target/release/bundle/appimage/second.AppImage'
    count=2
  fi
  assert_text "$CASE/stdout" ''
  assert_text "$CASE/stderr" "error: expected exactly one file matching '$pattern', found $count"
  for asset in "$name.deb" "$rpm" "$name.tar.gz" "$name.AppImage"; do
    assert_text "$CASE/dist-release/$asset" keep
  done
  [ "$(find "$CASE/dist-release" -type f | wc -l)" -eq 4 ] || fail 'invalid build published output'
done
printf 'PASS: packaging contracts (amd64, arm64, rejected inputs, missing/ambiguous AppImages)\n'
[ -z "$BASELINE" ] || printf 'PASS: baseline differential (rejections, legacy stdout, deb/rpm payloads, portable files/install script)\n'
