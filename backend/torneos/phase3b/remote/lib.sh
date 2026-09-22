# Phase 3B operator runners — shared shell contract (sourced, never executed).
#
#   • credentials are read from /dev/tty with echo off, kept in shell variables, unset on exit;
#   • they reach child processes only through a pipe from the `printf` BUILTIN (stdin) or, for
#     libpq, through PGPASSWORD in the child's environment — never argv, never a file;
#   • Production (rcyuuoaqfwcembdajcss) is refused in every ref/host/url argument;
#   • every evidence file is checked with a builtin substring test against every secret the
#     run knew before it is promoted from its temp name.
# Requires bash 3.2+ (macOS), node, /opt/homebrew/opt/libpq/bin/psql, the Supabase CA.

PROD_REF="rcyuuoaqfwcembdajcss"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
EVIDENCE_DIR="$HERE/../evidence"
MGMT="$HERE/mgmt.mjs"
MGMT_WRITE="$HERE/mgmt-write.mjs"
KEYCHAIN="$HERE/keychain.py"
PSQL_BIN="/opt/homebrew/opt/libpq/bin/psql"
CA_CERT="/Users/nicoavayu/Downloads/prod-ca-2021.crt"
KC_DB_SERVICE="arma2-torneos-nonprod-db"
KC_BRIDGE_SERVICE="arma2-torneos-nonprod-bridge"
KC_CORE_SERVICE="arma2-torneos-nonprod-core"
PAT=""
SECRETS_KNOWN=()
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

abort() { printf '\n!! ABORT: %s\n' "$*" >&2; exit 1; }
ok() { printf '  [ok] %s\n' "$*"; }
step() { printf '\n=== %s\n' "$*"; }

require_tty() { { : < /dev/tty; } 2>/dev/null || abort "PHASE3B_BLOCKED_NO_TTY (the agent cannot run this; the operator runs it)"; }
require_tools() {
  command -v node >/dev/null || abort "node missing"
  [[ -f "$MGMT" && -f "$MGMT_WRITE" ]] || abort "mgmt helpers missing"
  mkdir -p "$EVIDENCE_DIR"
}
require_psql() {
  [[ -x "$PSQL_BIN" ]] || abort "psql not found at $PSQL_BIN (brew install libpq)"
  [[ -f "$CA_CERT" && ! -L "$CA_CERT" ]] || abort "Supabase CA missing at $CA_CERT"
}
assert_ref() { # $1=label $2=value
  [[ "$2" =~ ^[a-z]{20}$ ]] || abort "$1 malformed"
  [[ "$2" != "$PROD_REF" ]] || abort "$1 is PRODUCTION — refused"
}
assert_not_prod() { [[ "$2" != *"$PROD_REF"* ]] || abort "$1 carries the Production ref — refused"; }
read_pat() {
  printf 'Supabase PAT (sbp_…), no echo: ' > /dev/tty
  IFS= read -rs PAT < /dev/tty || { printf '\n' > /dev/tty; abort "PAT_NOT_PROVIDED (EOF on the tty)"; } # EOF would otherwise kill the shell silently under set -e
  printf '\n' > /dev/tty
  [[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || abort "pat malformed"
  [[ "$PAT" != *"$PROD_REF"* ]] || abort "PRODUCTION_REF_IN_TOKEN"
  SECRETS_KNOWN+=("$PAT")
}
read_secret() { # $1=var name $2=prompt $3=regex
  local __v
  printf '%s: ' "$2" > /dev/tty
  IFS= read -rs __v < /dev/tty || { printf '\n' > /dev/tty; abort "$1 not provided (EOF on the tty)"; }
  printf '\n' > /dev/tty
  [[ "$__v" =~ $3 ]] || abort "$1 malformed"
  printf -v "$1" '%s' "$__v"
  SECRETS_KNOWN+=("$__v")
}
# Random URL-safe secret of N characters, produced without any process seeing it in argv.
gen_secret() { LC_ALL=C tr -dc 'A-Za-z0-9_-' < /dev/urandom | head -c "$1"; }
gen_hex() { od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'; }
# JSON-escape a value with node (value on stdin, never argv).
json_escape() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.stringify(s)))'; }
mgmt() { # op json-fields… → JSON line; PAT through the printf builtin pipe only
  printf '{"op":"%s","pat":"%s"%s}' "$1" "$PAT" "${2:-}" | node "$MGMT"
}
mgmt_write() { printf '{"op":"%s","pat":"%s"%s}' "$1" "$PAT" "${2:-}" | node "$MGMT_WRITE"; }
json_field() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],d);process.stdout.write(v==null?"":String(typeof v==="object"?JSON.stringify(v):v))})' "$1"; }
keychain_check() { python3 "$KEYCHAIN" check "$1" "$2"; local rc=$?; return $rc; } # 0 absent, 10 present
keychain_add() { printf '%s' "$3" | python3 "$KEYCHAIN" add "$1" "$2"; }
keychain_read() { # $1=service $2=account → value on stdout (captured by caller into a variable)
  /usr/bin/security find-generic-password -s "$1" -a "$2" -w 2>/dev/null
}
# Text with every known secret (the PAT, a contract secret) replaced, for output that is about to be
# shown or persisted (a captured error line from node, which redacts its own output already). Pure
# bash: the secret never becomes an argv of any process. promote_evidence stays the last gate.
redact_known() { # $1=text → stdout
  local out="$1" s
  for s in ${SECRETS_KNOWN[@]+"${SECRETS_KNOWN[@]}"}; do
    [[ -n "$s" && ${#s} -ge 8 ]] || continue
    out="${out//"$s"/«REDACTED»}"
  done
  printf '%s' "$out"
}
promote_evidence() { # $1=tmp $2=final — refuse if any known secret appears; never overwrite evidence
  [[ ! -e "$2" ]] || { rm -f "$1"; abort "EVIDENCE_EXISTS $2 (same-second stamp; re-run)"; }
  local content; content="$(cat "$1")"
  local s
  for s in ${SECRETS_KNOWN[@]+"${SECRETS_KNOWN[@]}"}; do
    [[ -n "$s" && ${#s} -ge 8 ]] || continue
    if [[ "$content" == *"$s"* ]]; then rm -f "$1"; abort "EVIDENCE_REJECTED_SECRET_LEAK"; fi
  done
  [[ "$content" != *"\"ref\":\"$PROD_REF\""* ]] || { rm -f "$1"; abort "EVIDENCE_REJECTED_PRODUCTION_TARGET"; }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" || { rm -f "$1"; abort "EVIDENCE_NOT_JSON"; }
  mv "$1" "$2"
  printf 'EVIDENCE %s\n' "$2"
  shasum -a 256 "$2"
}
cleanup_secrets() { unset PAT; PAT=""; SECRETS_KNOWN=(); unset PGPASSWORD; }
