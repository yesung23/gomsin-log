#!/usr/bin/env python3
"""Scan textual credential content in one commit or a non-ignored worktree.

Known signing-file history is checked separately by the workflow; gitleaks
provides the complementary full-history secret scan. Matched text is redacted.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys


# SHA-256(path + NUL + exact source line) for four reviewed, non-secret
# test/validator sentinels. A changed line or another match in the same file does
# not inherit the exception. Each reviewed digest may occur at most once.
REVIEWED_SENTINEL_DIGESTS = {
    "a66fe8dfb52860447083de0a1fdf766619c50a633ca636eb2f72b1b5add4911c",
    "478b3064be00b8c18dafcae96f1d65e933374b4f5ed29503d076b519022206bb",
    "6b7a1dcf985b8a8cab562f413497dcdeeeb1da2e787a90af81e4efbabbb864be",
    "e7c82e29f86af09b2699d1f22bd71cee7bdce7774ad7c63cbd4a9ae0bf6f6bdb",
}

PATTERNS = (
    r"-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}",
    r"store(Password|File)[[:space:]]*[=:]",
    r"keyPassword[[:space:]]*[=:]",
    r"MIIE[A-Za-z0-9+/]{40,}",
)


def line_digest(path: str, content: str) -> str:
    return hashlib.sha256(f"{path}\0{content}".encode()).hexdigest()


def main() -> int:
    revision = sys.argv[1] if len(sys.argv) == 2 else "HEAD"
    if len(sys.argv) > 2:
        print("usage: scan_signing_material.py [revision|--worktree]", file=sys.stderr)
        return 2

    worktree = revision == "--worktree"
    if not worktree:
        verify = subprocess.run(
            ["git", "rev-parse", "--verify", f"{revision}^{{commit}}"],
            text=True,
            capture_output=True,
            check=False,
        )
        if verify.returncode != 0:
            print(f"Cannot scan non-commit revision: {revision}", file=sys.stderr)
            return 2

    command = ["git", "grep"]
    if worktree:
        command.append("--untracked")
    command.append("-nIE")
    for pattern in PATTERNS:
        command.extend(("-e", pattern))
    if not worktree:
        command.append(revision)
    command.append("--")
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode == 1:
        print(f"No signing credential content found in {revision}.")
        return 0
    if result.returncode != 0:
        print("Signing-material scan could not complete.", file=sys.stderr)
        return result.returncode

    violations: list[tuple[str, str]] = []
    seen_sentinels: set[str] = set()
    for match in result.stdout.splitlines():
        parts = match.split(":", 2 if worktree else 3)
        if len(parts) != (3 if worktree else 4):
            print("Signing-material scan received an unparseable match.", file=sys.stderr)
            return 2
        if worktree:
            path, line_number, content = parts
        else:
            _, path, line_number, content = parts
        digest = line_digest(path, content)
        if digest not in REVIEWED_SENTINEL_DIGESTS or digest in seen_sentinels:
            violations.append((path, line_number))
        else:
            seen_sentinels.add(digest)

    if violations:
        print("Signing material or a signing-password assignment was detected:", file=sys.stderr)
        for path, line_number in violations:
            print(f"  {path}:{line_number}", file=sys.stderr)
        print("Matched contents were redacted.", file=sys.stderr)
        return 1

    print(f"Only the four exact reviewed non-secret sentinel lines matched in {revision}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
