#!/usr/bin/env bash
# Phase 3B — remote certification wrapper (operator-run; credentials via /dev/tty only).
#
#   certify-remote.sh <torneos_ref> <core_anon_key> <torneos_anon_key> password <email>
#   certify-remote.sh <torneos_ref> <core_anon_key> <torneos_anon_key> admin <email>
#
# `password`: prompts the Core (Staging) password of an existing synthetic user.
# `admin`: prompts the CORE service key (Staging), creates/reuses a confirmed synthetic user
#          with a generated password, then certifies. The service key is used ONLY against
#          https://<core>.supabase.co/auth/v1/admin/users and never leaves the node process.
# Core is pinned to hhyvmhgpapyuzjgxfnqv. Evidence: evidence/remote-certify-<UTC>.json (sanitized).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets' EXIT INT TERM HUP
REF="${1:-}"; CORE_ANON="${2:-}"; TORNEOS_ANON="${3:-}"; MODE="${4:-}"; EMAIL="${5:-}"
CORE_REF="hhyvmhgpapyuzjgxfnqv"
assert_ref "torneos ref" "$REF"
[[ "$MODE" == "password" || "$MODE" == "admin" ]] || abort "usage: certify-remote.sh <torneos_ref> <core_anon> <torneos_anon> password|admin <email>"
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || abort "email malformed"
assert_not_prod "core anon" "$CORE_ANON"; assert_not_prod "torneos anon" "$TORNEOS_ANON"
require_tty; require_tools
if [[ "$MODE" == "password" ]]; then read_secret CRED "Core (Staging) password for $EMAIL, no echo" '^.{8,200}$'; else read_secret CRED "Core (Staging) SERVICE key, no echo" '^(eyJ[A-Za-z0-9_.-]{40,}|sb_secret_[A-Za-z0-9_-]{20,})$'; fi
LOGIN_JSON="$(printf '{"mode":"%s","email":"%s","%s":%s}' "$MODE" "$EMAIL" "$([[ "$MODE" == password ]] && echo password || echo service_key)" "$(json_escape "$CRED")")"
unset CRED
TMP="$(mktemp "$EVIDENCE_DIR/.certify-XXXXXX")"
printf '{"core_ref":"%s","torneos_ref":"%s","core_anon":"%s","torneos_anon":"%s","login":%s}' "$CORE_REF" "$REF" "$CORE_ANON" "$TORNEOS_ANON" "$LOGIN_JSON" | node "$HERE/certify-remote.mjs" > "$TMP" || { cat "$TMP" >&2; rm -f "$TMP"; abort "certification run failed"; }
unset LOGIN_JSON
promote_evidence "$TMP" "$EVIDENCE_DIR/remote-certify-$STAMP.json"
node -e 'const d=require(process.argv[1]);for(const c of d.checks)console.log(String(c.status).padStart(3),"|",c.name,c.b03?"| "+c.b03:"");console.log("summary",JSON.stringify(d.summary));' "$EVIDENCE_DIR/remote-certify-$STAMP.json"
