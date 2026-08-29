#!/usr/bin/env bash
#
# Arma2 Torneos · Multimedia Staging — firewall DRY RUN.
#
# Parses and checks every firewall artifact in this directory. It loads nothing
# into the kernel, contacts no API and changes no state. Safe to run anywhere,
# including on a machine that is not the Staging host and has no nft at all.
#
#   ./validate.sh                 # check with a syntactic placeholder CIDR
#   ADMIN_CIDR=203.0.113.0/24 ./validate.sh
#
# Exit 0 = every check that COULD run passed. Checks that could not run are
# reported as SKIP with the reason, and never counted as passes: a validation
# that quietly degrades to nothing is worse than one that fails.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_CIDR="${ADMIN_CIDR:-203.0.113.0/24}"

pass=0; fail=0; skip=0
ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
gone() { printf '  SKIP  %s\n' "$1"; skip=$((skip+1)); }

echo "== nftables host policy =="
NFT_SRC="$HERE/nftables-host.staging.nft"
if [ ! -f "$NFT_SRC" ]; then
  bad "nftables-host.staging.nft is missing"
elif ! command -v nft >/dev/null 2>&1; then
  gone "nft is not installed; syntax not checked (install nftables on the Staging host)"
else
  # `nft -c` parses and validates WITHOUT committing. The placeholder is
  # substituted into a scratch copy so the repository never holds a real CIDR
  # and the file on disk is not modified.
  tmp="$(mktemp)"
  sed "s|@ADMIN_CIDR@|${ADMIN_CIDR}|g" "$NFT_SRC" > "$tmp"
  if nft -c -f "$tmp" 2>&1; then ok "nft -c -f parses cleanly"; else bad "nft -c -f rejected the ruleset"; fi
  rm -f "$tmp"
fi

# The placeholder must still be in the committed file: a substituted-in-place
# copy means someone's real address is about to be committed.
if grep -q '@ADMIN_CIDR@' "$NFT_SRC" 2>/dev/null; then
  ok "the committed ruleset still carries the ADMIN_CIDR placeholder"
else
  bad "the committed ruleset no longer carries @ADMIN_CIDR@ — a real address may have been baked in"
fi

echo "== DOCKER-USER container policy =="
SH_SRC="$HERE/docker-user.rules.sh"
if [ ! -f "$SH_SRC" ]; then
  bad "docker-user.rules.sh is missing"
else
  if bash -n "$SH_SRC"; then ok "bash -n parses docker-user.rules.sh"; else bad "docker-user.rules.sh is not valid bash"; fi
  if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S warning "$SH_SRC" "$HERE/validate.sh"; then ok "shellcheck clean"; else bad "shellcheck reported findings"; fi
  else
    gone "shellcheck is not installed"
  fi
  # A rule file that never wires itself into DOCKER-USER is a no-op that looks
  # like a policy, which is the worst of both.
  if grep -q 'DOCKER-USER' "$SH_SRC"; then ok "policy is wired into DOCKER-USER"; else bad "policy is never wired into DOCKER-USER"; fi
fi

echo "== Hetzner Cloud firewall spec =="
HZ_SRC="$HERE/hetzner-cloud-firewall.json"
if [ ! -f "$HZ_SRC" ]; then
  bad "hetzner-cloud-firewall.json is missing"
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$HZ_SRC"; then
    ok "hetzner-cloud-firewall.json is valid JSON"
  else
    bad "hetzner-cloud-firewall.json is not valid JSON"
  fi
  if grep -q 'ADMIN_CIDR_PLACEHOLDER' "$HZ_SRC"; then
    ok "the Hetzner spec still carries the ADMIN_CIDR placeholder"
  else
    bad "the Hetzner spec no longer carries ADMIN_CIDR_PLACEHOLDER"
  fi
else
  gone "python3 is not installed; JSON not parsed"
fi

echo "== unbound resolver policy =="
DNS_SRC="$HERE/../dns/unbound-media-staging.conf"
if [ ! -f "$DNS_SRC" ]; then
  bad "unbound-media-staging.conf is missing"
else
  if grep -q 'rcyuuoaqfwcembdajcss.supabase.co.*always_nxdomain' "$DNS_SRC"; then
    ok "Production is pinned to always_nxdomain"
  else
    bad "Production is NOT pinned to always_nxdomain"
  fi
  # A pinned CDN address is the failure mode this design exists to avoid.
  if grep -qE 'local-data.*(supabase|104\.|172\.6[4-9]\.|173\.245\.)' "$DNS_SRC"; then
    bad "the resolver pins an address for a Supabase or Cloudflare name"
  else
    ok "no Supabase or Cloudflare address is pinned"
  fi
  if command -v unbound-checkconf >/dev/null 2>&1; then
    if unbound-checkconf "$DNS_SRC"; then ok "unbound-checkconf accepted the fragment"; else bad "unbound-checkconf rejected the fragment"; fi
  else
    gone "unbound-checkconf is not installed"
  fi
fi

echo
printf 'validate.sh: %d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
