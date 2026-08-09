#!/usr/bin/env bash
#
# Arma2 Torneos · Multimedia Staging — firewall APPLY, with a deadman.
#
# NOT RUN BY THIS CHANGE. There is no host to run it on. It is committed because
# the alternative — a runbook that says "now run nft -f" — is how a VM gets
# locked out, and the safe primitive belongs in the repository rather than in
# someone's shell history.
#
# ===========================================================================
# The deadman
# ===========================================================================
# A default-drop `input` policy applied over a live SSH session is one typo away
# from an unreachable VM whose only recovery is Hetzner's console. So:
#
#   1. validate.sh must pass;
#   2. the CURRENT ruleset is saved;
#   3. an `at`/systemd-timer revert is armed BEFORE the new rules load;
#   4. the new rules load;
#   5. the operator has CONFIRM_WINDOW seconds to open a SECOND ssh session and
#      run `--confirm`, which disarms the revert;
#   6. if they cannot — because the rules locked them out — the revert fires on
#      its own and the VM comes back.
#
# Step 5 must be a NEW session. The existing one is already ESTABLISHED and is
# accepted by conntrack whatever the rules say, so it proves nothing about
# whether anyone can still get in.
#
#   ./apply-with-rollback.sh --dry-run          # validate only, load nothing
#   ADMIN_CIDR=203.0.113.0/24 ./apply-with-rollback.sh --i-am-on-the-console
#   ./apply-with-rollback.sh --confirm          # from a NEW ssh session

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${STATE_DIR:-/var/lib/arma2-media-staging/firewall}"
BACKUP="$STATE_DIR/nftables.pre-apply.nft"
RAW_DUMP_TMP=""
BACKUP_TMP=""
REVERT_UNIT=arma2-media-firewall-revert
CONFIRM_WINDOW="${CONFIRM_WINDOW:-300}"

cleanup() {
  [ -z "$RAW_DUMP_TMP" ] || rm -f "$RAW_DUMP_TMP"
  [ -z "$BACKUP_TMP" ] || rm -f "$BACKUP_TMP"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
die() { printf 'apply-with-rollback: %s\n' "$1" >&2; exit 1; }

mode="${1:-}"
[ -n "$mode" ] || die "one of --dry-run | --i-am-on-the-console | --confirm is required"

# --- --confirm ---------------------------------------------------------------
if [ "$mode" = "--confirm" ]; then
  systemctl stop "${REVERT_UNIT}.timer" 2>/dev/null || true
  systemctl disable "${REVERT_UNIT}.timer" 2>/dev/null || true
  printf 'revert disarmed; the ruleset in the kernel is now permanent until changed again\n'
  printf 'the pre-apply ruleset is still at %s\n' "$BACKUP"
  exit 0
fi

# --- validation, always ------------------------------------------------------
"$HERE/validate.sh" || die "validate.sh failed; nothing was loaded"

if [ "$mode" = "--dry-run" ]; then
  printf 'dry run complete: validation passed, nothing was loaded\n'
  exit 0
fi

[ "$mode" = "--i-am-on-the-console" ] \
  || die "unknown mode '$mode'"

[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v nft >/dev/null 2>&1 || die "nft is not installed"
command -v iptables >/dev/null 2>&1 || die "iptables is not installed"

: "${ADMIN_CIDR:?set ADMIN_CIDR to the range administrative SSH will come from}"
# A placeholder reaching the kernel means SSH is allowed from a documentation
# range and from nowhere else, i.e. from nobody.
[ "$ADMIN_CIDR" != "203.0.113.0/24" ] \
  || die "ADMIN_CIDR is still the documentation placeholder; applying it locks everyone out"

mkdir -p "$STATE_DIR"

# --- 2. save the current ruleset ---------------------------------------------
# Capture and validate the raw dump separately. Checking the combined file would
# accept the synthetic flush line as proof that nft emitted a useful ruleset.
RAW_DUMP_TMP="$(mktemp "${BACKUP}.raw.XXXXXX")"
if ! nft list ruleset > "$RAW_DUMP_TMP"; then
  die "could not dump the current nft ruleset; nothing was loaded"
fi
if [ ! -s "$RAW_DUMP_TMP" ] || ! grep -q '[^[:space:]]' "$RAW_DUMP_TMP"; then
  die "nft returned an empty or whitespace-only ruleset; nothing was loaded"
fi

# Build beside the real backup and publish only after both writes succeeded.
BACKUP_TMP="$(mktemp "${BACKUP}.tmp.XXXXXX")"
printf 'flush ruleset\n' > "$BACKUP_TMP"
cat "$RAW_DUMP_TMP" >> "$BACKUP_TMP"
mv "$BACKUP_TMP" "$BACKUP"
BACKUP_TMP=""
rm -f "$RAW_DUMP_TMP"
RAW_DUMP_TMP=""
iptables-save > "$STATE_DIR/iptables.pre-apply.rules"
printf 'saved current ruleset to %s\n' "$BACKUP"

# --- 3. arm the revert BEFORE loading anything -------------------------------
# Armed first, deliberately. Arming after the load leaves a window in which the
# rules are live and nothing will undo them.
cat > "/etc/systemd/system/${REVERT_UNIT}.service" <<UNIT
[Unit]
Description=Revert the Arma2 media Staging firewall to its pre-apply state
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f ${BACKUP}
ExecStart=/usr/sbin/iptables-restore ${STATE_DIR}/iptables.pre-apply.rules
ExecStart=/usr/bin/systemctl disable ${REVERT_UNIT}.timer
UNIT

cat > "/etc/systemd/system/${REVERT_UNIT}.timer" <<UNIT
[Unit]
Description=Deadman for the Arma2 media Staging firewall apply
[Timer]
OnActiveSec=${CONFIRM_WINDOW}
AccuracySec=1s
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl start "${REVERT_UNIT}.timer"
printf 'revert armed: the pre-apply ruleset returns in %ss unless --confirm runs first\n' "$CONFIRM_WINDOW"

# --- 4. load ------------------------------------------------------------------
tmp="$(mktemp)"
trap 'rm -f "$tmp"; cleanup' EXIT
sed "s|@ADMIN_CIDR@|${ADMIN_CIDR}|g" "$HERE/nftables-host.staging.nft" > "$tmp"
nft -f "$tmp"
bash "$HERE/docker-user.rules.sh"

# --- 5. hand over -------------------------------------------------------------
cat <<MSG

Rules are live. The revert fires in ${CONFIRM_WINDOW}s.

  DO NOT confirm from this session — it is already ESTABLISHED and conntrack
  accepts it whatever the input policy says. Open a NEW ssh session and run:

      sudo ${HERE}/apply-with-rollback.sh --confirm

  If the new session does not connect, do nothing. The revert restores
  ${BACKUP} on its own.
MSG
