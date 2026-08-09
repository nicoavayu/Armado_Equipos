#!/usr/bin/env bash
#
# Arma2 Torneos · Multimedia Staging VM — CONTAINER egress policy.
#
# TEMPLATE. NOT APPLIED. `./validate.sh` parses it; `./apply-with-rollback.sh`
# is the only path that installs it, and it arms a revert first.
#
# ===========================================================================
# Why iptables here and nftables next door
# ===========================================================================
# Docker programs the forward path itself, through iptables-nft, and reserves
# exactly one chain for operators: DOCKER-USER, which it jumps to BEFORE any of
# its own accept rules. Rules placed there are the supported way to filter
# container traffic and survive `docker network` operations, daemon restarts and
# container recreation.
#
# Writing the same policy as a native nft `forward` chain looks cleaner and is
# a trap: the two rulesets are evaluated as independent hooks, so a drop in a
# private table overrides Docker's accepts invisibly, and Docker's rules keep
# being rewritten underneath. One owner per hook. This file is that owner.
#
# ===========================================================================
# What this actually enforces, stated honestly
# ===========================================================================
# Per-service egress PORTS, and nothing about destinations. `--dport 443 ACCEPT`
# permits the processor to open TLS to every host on the internet that listens
# on 443. It does not permit "Supabase Staging" and it does not deny
# "Production": a packet filter has no way to tell those apart, since the name
# is inside the encrypted handshake.
#
# What it does buy, precisely:
#   - a compromised processor cannot exfiltrate over SMTP, DNS-to-arbitrary,
#     SSH, or any other port;
#   - clamd has generic tcp/80,443 egress for freshclam and can therefore reach
#     an HTTPS Supabase host at the network layer. It holds no Supabase
#     credential and does not share processor-egress, which bounds impact;
#   - the renewer cannot reach clamd, and clamd cannot reach the renewer;
#   - media-internal is dropped explicitly, so the `internal: true` guarantee
#     does not rest on Docker's implementation alone.

set -euo pipefail

IPT="${IPT:-iptables}"

NET_INTERNAL=172.31.20.0/28
NET_PROCESSOR=172.31.20.16/28
NET_CLAMAV=172.31.20.32/28
NET_RENEWER=172.31.20.48/28

CHAIN=ARMA2-MEDIA
JUMP_FROM=DOCKER-USER

# Own chain rather than rules appended to DOCKER-USER directly: it can be
# flushed and rebuilt idempotently without touching anything else Docker or
# another operator put there.
"$IPT" -N "$CHAIN" 2>/dev/null || true
"$IPT" -F "$CHAIN"

# --- established --------------------------------------------------------------
"$IPT" -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN

# --- media-internal: clamd only, then no general egress ------------------------
# The processor and clamd are the only members. Permit only the processor's
# required east-west TCP connection to clamd:3310; responses are covered by the
# established rule above. Everything else sourced from or destined to this
# internal subnet remains dropped, so this is not a general egress path.
"$IPT" -A "$CHAIN" -s "$NET_INTERNAL" -d "$NET_INTERNAL" -p tcp --dport 3310 -j RETURN
"$IPT" -A "$CHAIN" -s "$NET_INTERNAL" -j DROP
"$IPT" -A "$CHAIN" -d "$NET_INTERNAL" -j DROP

# --- processor: HTTPS out only ------------------------------------------------
"$IPT" -A "$CHAIN" -s "$NET_PROCESSOR" -p tcp --dport 443 -j RETURN
"$IPT" -A "$CHAIN" -s "$NET_PROCESSOR" -j DROP

# --- clamav: signature mirrors only -------------------------------------------
# freshclam fetches CVD/CDIFF over HTTPS from database.clamav.net; port 80 is
# retained because several official mirrors still redirect through it and a
# silent signature-update failure degrades into a worker that stops certifying
# scans seven days later, which is a slow and confusing outage.
# These are port rules, not destination rules. They can reach any tcp/80,443
# endpoint, including Supabase; clamd's isolation is the absence of credentials.
"$IPT" -A "$CHAIN" -s "$NET_CLAMAV" -p tcp -m multiport --dports 80,443 -j RETURN
"$IPT" -A "$CHAIN" -s "$NET_CLAMAV" -j DROP

# --- renewer: HTTPS out only --------------------------------------------------
"$IPT" -A "$CHAIN" -s "$NET_RENEWER" -p tcp --dport 443 -j RETURN
"$IPT" -A "$CHAIN" -s "$NET_RENEWER" -j DROP

# --- anything else on this host's docker bridges -------------------------------
# Default-deny for subnets this policy does not name, so a network added later
# without a corresponding rule fails closed instead of inheriting egress.
"$IPT" -A "$CHAIN" -s 172.31.20.0/24 -j DROP

# --- wire it in ---------------------------------------------------------------
# Idempotent: the jump is removed if present, then inserted at position 1 so it
# is evaluated before anything already in DOCKER-USER.
"$IPT" -D "$JUMP_FROM" -j "$CHAIN" 2>/dev/null || true
"$IPT" -I "$JUMP_FROM" 1 -j "$CHAIN"

echo "ARMA2-MEDIA installed into ${JUMP_FROM}"
