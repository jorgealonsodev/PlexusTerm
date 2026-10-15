#!/usr/bin/env bash
# Writes <dir>/checksums.txt with the SHA-256 of every other file in <dir>
# (sha256sum format, sorted by name) and verifies it.
# Usage: scripts/checksums.sh <dir>
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "Usage: $0 <dir>" >&2
  exit 2
fi

cd "$1"
files=()
while IFS= read -r f; do
  files+=("$f")
done < <(find . -maxdepth 1 -type f ! -name checksums.txt -printf '%f\n' | LC_ALL=C sort)

if [ "${#files[@]}" -eq 0 ]; then
  echo "error: no files to checksum in $1" >&2
  exit 1
fi

sha256sum -- "${files[@]}" >checksums.txt
sha256sum -c checksums.txt
