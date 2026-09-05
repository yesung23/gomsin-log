#!/usr/bin/env python3
"""Direct sensitivity checks for the tracked signing-material scanner."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNER = Path(__file__).with_name("scan_signing_material.py")
SENTINEL_PATHS = (
    "src/lib/partnerBriefing/modelInputGate.test.ts",
    "src/lib/partnerBriefing/pipeline.test.ts",
    "supabase/functions/_shared/appleAuthCredentials.ts",
    "supabase/functions/_shared/appleAuthCredentials_test.ts",
)
SAME_FILE = SENTINEL_PATHS[0]


def run_scanner(repo: Path, target: str = "HEAD") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCANNER), target],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def commit(repo: Path, message: str) -> None:
    git(repo, "add", ".")
    git(
        repo,
        "-c",
        "user.name=CI Scanner Test",
        "-c",
        "user.email=ci-scanner@example.invalid",
        "commit",
        "-qm",
        message,
    )


def require_success(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        raise AssertionError(f"{label} was rejected:\n{result.stderr}")


def require_safe_failure(
    result: subprocess.CompletedProcess[str],
    label: str,
    forbidden_output: str,
    expected_path: str = SAME_FILE,
) -> None:
    if result.returncode != 1:
        raise AssertionError(f"{label} was not detected")
    if expected_path not in result.stderr:
        raise AssertionError(f"{label} did not report its file location")
    if forbidden_output in result.stderr or forbidden_output in result.stdout:
        raise AssertionError(f"{label} leaked matched credential text to output")


require_success(run_scanner(REPO_ROOT, "--worktree"), "the reviewed repository worktree")

with tempfile.TemporaryDirectory(prefix="gomsinlog-signing-scan-") as temp_dir:
    fixture_repo = Path(temp_dir)
    git(fixture_repo, "init", "-q")

    originals: dict[str, str] = {}
    for relative in SENTINEL_PATHS:
        source = REPO_ROOT / relative
        target = fixture_repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        originals[relative] = source.read_text(encoding="utf-8")
        target.write_text(originals[relative], encoding="utf-8")
    commit(fixture_repo, "reviewed sentinels")
    require_success(run_scanner(fixture_repo), "the four reviewed sentinel lines")

    begin = "-" * 5 + "BEGIN PRIVATE KEY" + "-" * 5
    end = "-" * 5 + "END PRIVATE KEY" + "-" * 5
    synthetic_body = "MIIE" + "A" * 80
    same_file = fixture_repo / SAME_FILE
    same_file.write_text(
        originals[SAME_FILE]
        + f"\nconst syntheticCredential = `{begin}\n{synthetic_body}\n{end}`;\n",
        encoding="utf-8",
    )
    commit(fixture_repo, "synthetic private key control")
    require_safe_failure(
        run_scanner(fixture_repo),
        "a different credential-shaped private key in an allowlisted file",
        synthetic_body,
    )

    synthetic_password = "synthetic-password-control"
    same_file.write_text(
        originals[SAME_FILE]
        + "\nstore"
        + f"Password = {synthetic_password}\n",
        encoding="utf-8",
    )
    commit(fixture_repo, "synthetic signing password control")
    require_safe_failure(
        run_scanner(fixture_repo),
        "a signing-password assignment in an allowlisted file",
        synthetic_password,
    )

    same_file.write_text(originals[SAME_FILE], encoding="utf-8")
    commit(fixture_repo, "restore reviewed source")
    for relative in (".github/workflows/credential-control.yml", "package-lock.json"):
        target = fixture_repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"{begin}\n{synthetic_body}\n{end}\n", encoding="utf-8")
        require_safe_failure(
            run_scanner(fixture_repo, "--worktree"),
            f"untracked credential in {relative}", synthetic_body, relative,
        )
        commit(fixture_repo, "credential in formerly excluded path")
        require_safe_failure(
            run_scanner(fixture_repo),
            f"committed credential in {relative}", synthetic_body, relative,
        )
        target.unlink()
        commit(fixture_repo, "remove synthetic credential")

    for relative in SENTINEL_PATHS:
        target = fixture_repo / relative
        sentinel = next(line for line in originals[relative].splitlines() if begin in line)
        target.write_text(originals[relative] + "\n" + sentinel + "\n", encoding="utf-8")
        require_safe_failure(
            run_scanner(fixture_repo, "--worktree"),
            f"duplicate reviewed sentinel in {relative}", sentinel, relative,
        )
        target.write_text(originals[relative], encoding="utf-8")
    require_success(run_scanner(fixture_repo, "--worktree"), "restored sentinel controls")

print("Signing-material scanner controls passed.")
