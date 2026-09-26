#!/usr/bin/env bash
# GATEWAY REMOTE — the human approval of the session's pending write.
#
#   ARMA2_SESSION_DIR=<same dir as the session> bash approve-plan.sh
#
# Shows the LAST pending PLAN block of the session transcript (redacted, no secrets) and the exact phrase it requires,
# asks y/N on the tty, and only on "y" sends that phrase to the session FIFO. Anything else sends nothing.
set -euo pipefail
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ -n "${ARMA2_SESSION_DIR:-}" ]] || abort "ARMA2_SESSION_DIR is required"
T="$ARMA2_SESSION_DIR/transcript.log"; F="$ARMA2_SESSION_DIR/ctl"
[[ -f "$T" && -p "$F" ]] || abort "no session transcript/FIFO in ARMA2_SESSION_DIR"
{ : < /dev/tty; } 2>/dev/null || abort "run it in a terminal"
START="$(grep -n '^PLAN [0-9a-f]\{12\}:' "$T" | tail -1 | cut -d: -f1 || true)"
[[ -n "$START" ]] || abort "no pending PLAN in the transcript"
BLOCK="$(tail -n +"$START" "$T")"
grep -q '^phrase accepted$\|^STOP \|^OK ' <<<"$BLOCK" && abort "the last PLAN is no longer pending"
PHRASE="$(grep -A1 'must send exactly:$' <<<"$BLOCK" | tail -1 | sed 's/^  //')"
[[ "$PHRASE" =~ ^[A-Z0-9\ ]+[a-z0-9-]*\ ?[a-z0-9-]*\ [0-9a-f]{12}$ ]] || abort "phrase not recognised"
printf '%s\n\nSend this phrase to the session? [y/N] ' "$BLOCK" > /dev/tty
printf '\033[?2004l' > /dev/tty
IFS= read -r ANSWER < /dev/tty
ANSWER="${ANSWER//[^a-zA-Z]/}"; ANSWER="${ANSWER#200}"; ANSWER="${ANSWER%201}"
[[ "$ANSWER" == "y" || "$ANSWER" == "Y" ]] || abort "not sent"
printf '%s\n' "$PHRASE" > "$F"
printf 'sent.\n' > /dev/tty
