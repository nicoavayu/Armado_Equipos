#!/usr/bin/env python3
"""keychain.py — macOS Keychain custody for Phase 3B non-production credentials
(the Torneos non-prod project db password, the bridge key ring). Verbatim contract of the
certified a2_keychain.py (a2-staging-db-readonly-rotate): pty for `add`, no -U, no delete.

Three operations, each printing status keywords only — never the value:

  check   <service> <account>   exit 0 = ABSENT, exit 10 = PRESENT, other = error
  add     <service> <account>   reads the secret from STDIN and stores it
  verify  <service> <account>   reads the expected secret from STDIN, reads the
                                stored one back, and reports presence + length

Why a pty for `add`: `security add-generic-password -w <value>` would expose the
secret in argv to `ps` for every process of this user. With a bare `-w` the tool
prompts instead and reads the answer through readpassphrase(3), which wants a
tty and not a pipe. So we give it a tty we own; the secret lives only in this
process's memory.

There is deliberately no `-U` and no delete: replacing an existing entry is a
silent rotation, which is exactly what the caller must never do.
"""

import os
import pty
import select
import subprocess
import sys
import time

TIMEOUT_SECONDS = 20
MIN_LENGTH = 24
SECURITY = "/usr/bin/security"
LABEL = "arma2 torneos phase3b non-production credential"


def _read_secret_from_stdin() -> str:
    return sys.stdin.buffer.read().decode("utf-8").rstrip("\n")


def op_check(service: str, account: str) -> int:
    """Existence only. No -w and no -g, so no value can be printed."""
    proc = subprocess.run(
        [SECURITY, "find-generic-password", "-s", service, "-a", account],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if proc.returncode == 0:
        print("KEYCHAIN_ENTRY_PRESENT")
        return 10
    print("KEYCHAIN_ENTRY_ABSENT")
    return 0


def op_add(service: str, account: str) -> int:
    secret = _read_secret_from_stdin()
    if len(secret) < MIN_LENGTH:
        print("KEYCHAIN_ADD_SECRET_TOO_SHORT", file=sys.stderr)
        return 3

    # The caller has already proven the entry is absent; without -U this call
    # fails rather than overwriting if that ever stops being true.
    argv = [
        SECURITY, "add-generic-password",
        "-s", service,
        "-a", account,
        "-D", LABEL,
        "-w",
    ]

    pid, master = pty.fork()
    if pid == 0:
        os.execv(argv[0], argv)
        os._exit(127)

    deadline = time.time() + TIMEOUT_SECONDS
    payload = (secret + "\n").encode("utf-8")
    writes_done = 0
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([master], [], [], 0.5)
            if not ready:
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            # `security` asks twice: once for the password, once to confirm.
            # We answer each prompt; we never echo what it printed.
            if chunk.rstrip().endswith(b":") and writes_done < 2:
                os.write(master, payload)
                writes_done += 1
    finally:
        payload = b"\x00" * len(payload)
        try:
            os.close(master)
        except OSError:
            pass

    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status
    if code != 0:
        print("KEYCHAIN_ADD_FAILED", file=sys.stderr)
        return 4
    print("KEYCHAIN_ADD_OK")
    return 0


def op_verify(service: str, account: str) -> int:
    """Read the entry back and compare it to the expected value.

    The comparison happens here so the answer can be reduced to a keyword and a
    length before anything is printed. `-w` does put the value on this process's
    stdin pipe; it never reaches stdout, a log, or argv.
    """
    expected = _read_secret_from_stdin()
    proc = subprocess.run(
        [SECURITY, "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        print("KEYCHAIN_VERIFY_NOT_FOUND", file=sys.stderr)
        return 5
    stored = proc.stdout.decode("utf-8").rstrip("\n")
    if not stored:
        print("KEYCHAIN_VERIFY_EMPTY", file=sys.stderr)
        return 6
    if expected and stored != expected:
        # Length is safe to print; the value is not, and neither is a diff.
        print(f"KEYCHAIN_VERIFY_MISMATCH length={len(stored)}", file=sys.stderr)
        return 7
    print(f"KEYCHAIN_VERIFY_OK length={len(stored)}")
    return 0


def main() -> int:
    if len(sys.argv) != 4:
        print("KEYCHAIN_BAD_ARGS", file=sys.stderr)
        return 2
    op, service, account = sys.argv[1], sys.argv[2], sys.argv[3]
    if op == "check":
        return op_check(service, account)
    if op == "add":
        return op_add(service, account)
    if op == "verify":
        return op_verify(service, account)
    print("KEYCHAIN_UNKNOWN_OP", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
