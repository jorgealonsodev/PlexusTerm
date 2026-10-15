#!/usr/bin/env bash
# Runs the ignored OpenSSH interoperability tests against a disposable
# Alpine container (sshd + sftp-server, TCP forwarding enabled because Alpine
# disables it by default) bound to 127.0.0.1 only.
# Requires Docker. Usage: scripts/openssh-interop.sh
set -euo pipefail

IMAGE="alpine:3.20"
NAME="oxyterm-interop-$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N '' -C oxyterm-interop -f "$WORK/id_ed25519"
PUBKEY="$(cat "$WORK/id_ed25519.pub")"

docker run -d --name "$NAME" -p 127.0.0.1::22 -e PUBKEY="$PUBKEY" "$IMAGE" sh -c '
  set -e
  apk add --no-cache openssh-server openssh-sftp-server >/dev/null
  ssh-keygen -A >/dev/null
  adduser -D -s /bin/sh tester
  passwd -u tester >/dev/null 2>&1 || true
  mkdir -p /home/tester/.ssh
  echo "$PUBKEY" > /home/tester/.ssh/authorized_keys
  chown -R tester:tester /home/tester/.ssh
  chmod 700 /home/tester/.ssh && chmod 600 /home/tester/.ssh/authorized_keys
  exec /usr/sbin/sshd -D -e -o PasswordAuthentication=no -o AllowTcpForwarding=yes
' >/dev/null

PORT="$(docker port "$NAME" 22/tcp | head -n1 | sed 's/.*://')"
echo "Waiting for sshd on 127.0.0.1:$PORT..."
for _ in $(seq 60); do
  if docker logs "$NAME" 2>&1 | grep -q "Server listening"; then break; fi
  sleep 1
done
docker logs "$NAME" 2>&1 | grep -q "Server listening" || { docker logs "$NAME"; exit 1; }
ssh -V 2>/dev/null || true
docker exec "$NAME" sh -c 'sshd -V 2>&1 | head -n1' || true

cd "$ROOT/src-tauri"
OXYTERM_INTEROP_PORT="$PORT" \
OXYTERM_INTEROP_USER=tester \
OXYTERM_INTEROP_KEY="$WORK/id_ed25519" \
  cargo test --lib interop_tests -- --ignored --test-threads=1
