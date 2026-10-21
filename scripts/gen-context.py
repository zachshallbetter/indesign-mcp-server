#!/usr/bin/env python3
"""Deterministically compile canonical project sources into agent context projections."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
POLICY_PATH = ROOT / "CONTEXT_SOURCES.json"
FALLBACK_POLICY_PATH = ROOT / "CONTEXT_SOURCES_TEMPLATE.json"
AGENTS = ROOT / ".agents"
GIT_TIMEOUT_SECONDS = 5
DEFAULT_SENSITIVE_PATTERNS = (
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*credentials*.json",
    "*secrets*.json",
)


class ContextError(RuntimeError):
    """A user-actionable context compilation failure."""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_path_filters(values: list[str]) -> tuple[str, ...]:
    normalized = []
    for value in values:
        path = Path(value)
        if not value or path.is_absolute() or ".." in path.parts:
            raise ContextError(
                "--path values must be non-empty relative paths inside the project"
            )
        relative = path.as_posix().rstrip("/") or "."
        if not (ROOT / relative).exists():
            raise ContextError(f"--path does not exist: {value}")
        normalized.append(relative)
    return tuple(sorted(set(normalized)))


def run_git(path: Path, args: list[str]) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(path), *args],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=GIT_TIMEOUT_SECONDS,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def redact_remote(remote: str | None) -> str | None:
    if not remote:
        return remote
    return re.sub(r"(://)([^/@]+)@", r"\1", remote)


def one_repo_state(path: Path, rel: str) -> dict | None:
    commit = run_git(path, ["rev-parse", "HEAD"])
    if not commit:
        return None
    branch = run_git(path, ["branch", "--show-current"]) or None
    status = run_git(path, ["status", "--porcelain"])
    remote = redact_remote(run_git(path, ["remote", "get-url", "origin"]))
    return {
        "path": rel,
        "commit": commit,
        "branch": branch,
        "dirty": bool(status),
        "remote": remote,
    }


def repository_state() -> dict:
    """Capture provenance only; context validity is source-digest based.

    Exact HEAD cannot be a validity predicate for tracked generated files without
    creating a self-reference. We still retain the observed Git state so agents can
    identify the checkout that produced the projection.
    """
    root_state = one_repo_state(ROOT, ".")
    if not root_state:
        return {"available": False, "validationRole": "provenance", "repositories": []}

    repos = [root_state]
    raw = run_git(ROOT, ["submodule", "status", "--recursive"])
    if raw:
        for line in raw.splitlines():
            parts = line.strip().lstrip("-+U").split()
            if len(parts) < 2:
                continue
            rel = parts[1]
            state = one_repo_state(ROOT / rel, rel)
            if state:
                repos.append(state)
            else:
                repos.append(
                    {
                        "path": rel,
                        "commit": parts[0],
                        "branch": None,
                        "dirty": None,
                        "remote": None,
                    }
                )
    return {"available": True, "validationRole": "provenance", "repositories": repos}


def load_policy() -> dict:
    path = POLICY_PATH if POLICY_PATH.exists() else FALLBACK_POLICY_PATH
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContextError(f"cannot load context policy {path}: {exc}") from exc
    if not isinstance(policy, dict):
        raise ContextError("context policy must be a JSON object")
    required = {
        "excludeDirectories": list,
        "excludePaths": list,
        "includeExtensions": list,
        "maxFileBytes": int,
    }
    for key, expected in required.items():
        value = policy.get(key)
        if not isinstance(value, expected):
            raise ContextError(f"context policy field {key!r} must be a {expected.__name__}")
    if policy["maxFileBytes"] <= 0:
        raise ContextError("context policy maxFileBytes must be positive")
    list_fields = (
        "excludeDirectories",
        "excludePaths",
        "includeExtensions",
        "includeFiles",
        "excludePatterns",
    )
    for key in list_fields:
        if key in policy and not isinstance(policy[key], list):
            raise ContextError(f"context policy field {key!r} must be a list")
    return policy


def source_files(
    policy: dict, path_filters: tuple[str, ...] = ()
) -> tuple[list[tuple[str, bytes]], dict[str, int]]:
    ex_dirs = set(policy["excludeDirectories"])
    ex_paths = set(policy["excludePaths"])
    exts = set(policy["includeExtensions"])
    include_files = set(policy.get("includeFiles", []))
    max_bytes = int(policy["maxFileBytes"])
    max_total_bytes = policy.get("maxTotalBytes")
    if max_total_bytes is not None and (
        not isinstance(max_total_bytes, int) or max_total_bytes <= 0
    ):
        raise ContextError("context policy maxTotalBytes must be a positive integer")
    include_vendor = bool(policy.get("includeVendor", True))
    sensitive_patterns = tuple(
        DEFAULT_SENSITIVE_PATTERNS + tuple(policy.get("excludePatterns", []))
    )
    result: list[tuple[str, bytes]] = []
    skipped: dict[str, int] = {}
    total_bytes = 0

    for path in ROOT.rglob("*"):
        if path.is_symlink():
            skipped["symlink"] = skipped.get("symlink", 0) + 1
            continue
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        parts = rel.split("/")
        if parts[0] == ".git":
            continue
        if path_filters and not any(
            rel == selected or rel.startswith(selected + "/") for selected in path_filters
        ):
            skipped["path-filter"] = skipped.get("path-filter", 0) + 1
            continue
        if any(part in ex_dirs for part in parts[:-1]):
            skipped["excluded-directory"] = skipped.get("excluded-directory", 0) + 1
            continue
        if not include_vendor and parts[0] == "vendor":
            skipped["vendor"] = skipped.get("vendor", 0) + 1
            continue
        if rel in ex_paths:
            continue
        if any(fnmatch.fnmatch(rel, pattern) for pattern in sensitive_patterns):
            skipped["excluded-path"] = skipped.get("excluded-path", 0) + 1
            continue
        if rel not in include_files and path.suffix.lower() not in exts:
            skipped["extension"] = skipped.get("extension", 0) + 1
            continue
        try:
            before = path.stat()
        except OSError as exc:
            raise ContextError(f"cannot stat eligible source {rel}: {exc}") from exc
        if before.st_size > max_bytes:
            skipped["size"] = skipped.get("size", 0) + 1
            continue
        try:
            data = path.read_bytes()
            data.decode("utf-8")
            after = path.stat()
        except (OSError, UnicodeDecodeError) as exc:
            raise ContextError(f"cannot read eligible source {rel}: {exc}") from exc
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (
            after.st_size,
            after.st_mtime_ns,
            after.st_ino,
        ):
            raise ContextError(f"source changed during compilation: {rel}")
        if max_total_bytes is not None and total_bytes + len(data) > max_total_bytes:
            raise ContextError(f"context source total exceeds maxTotalBytes at {rel}")
        result.append((rel, data))
        total_bytes += len(data)

    if skipped:
        print(
            "excluded " + ", ".join(f"{key}={value}" for key, value in sorted(skipped.items())),
            file=sys.stderr,
        )
    return sorted(result, key=lambda item: item[0]), skipped


def build(path_filters: tuple[str, ...] = ()) -> tuple[dict, str, str]:
    policy = load_policy()
    sources, skipped = source_files(policy, path_filters)
    entries = [
        {"path": rel, "bytes": len(data), "sha256": sha(data)} for rel, data in sources
    ]
    aggregate = sha(
        "\n".join(f"{entry['path']}:{entry['sha256']}" for entry in entries).encode()
    )
    repos = repository_state()
    lock = {
        "format": "2",
        "generatorVersion": VERSION,
        "root": ".",
        "validityBasis": "aggregate-source-digest",
        "selectedPaths": list(path_filters),
        "sourceSelection": {
            "includedCount": len(sources),
            "includedBytes": sum(entry["bytes"] for entry in entries),
            "excludedCounts": dict(sorted(skipped.items())),
        },
        "repositoryState": repos,
        "aggregateSourceDigest": aggregate,
        "sources": entries,
    }

    index = [
        "# Project Context Index",
        f"> Generator: {VERSION}",
        f"> Source digest: `{aggregate}`",
        "",
        "> Generated projection. Canonical sources remain authoritative.",
        "",
    ]
    full = [
        "# PROJECT COMPILED CONTEXT",
        f"Generator: {VERSION}",
        f"Source digest: {aggregate}",
        "",
        "> Generated projection. Canonical sources remain authoritative.",
        "",
    ]

    for rel, data in sources:
        digest = sha(data)
        index.append(f"- `{rel}` | {len(data)} bytes | `{digest}`")
        full.extend(["", "=" * 72, f"FILE: {rel}", "=" * 72, "", data.decode("utf-8")])

    return lock, "\n".join(index) + "\n", "\n".join(full) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--path",
        action="append",
        dest="path_filters",
        default=[],
        help="compile only this relative file or directory (repeatable)",
    )
    args = parser.parse_args()
    try:
        path_filters = normalize_path_filters(args.path_filters)
        lock, index, full = build(path_filters)
    except ContextError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.check:
        lock_path = AGENTS / "context-lock.json"
        if not lock_path.exists():
            print("STALE: context lock missing", file=sys.stderr)
            return 2
        try:
            current = json.loads(lock_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            print(f"STALE: context lock is unreadable: {exc}", file=sys.stderr)
            return 2
        if current.get("aggregateSourceDigest") != lock["aggregateSourceDigest"]:
            print("STALE: source digest differs", file=sys.stderr)
            return 2
        if current.get("generatorVersion") != VERSION:
            print("STALE: generator version differs", file=sys.stderr)
            return 2
        for key in ("format", "root", "validityBasis", "selectedPaths", "sourceSelection", "sources"):
            if current.get(key) != lock[key]:
                print(f"STALE: context lock field differs: {key}", file=sys.stderr)
                return 2
        if not (AGENTS / "llms.txt").exists() or not (AGENTS / "llms-full.txt").exists():
            print("STALE: generated corpus missing", file=sys.stderr)
            return 2
        if (AGENTS / "llms.txt").read_text(encoding="utf-8") != index:
            print("STALE: llms.txt differs", file=sys.stderr)
            return 2
        if (AGENTS / "llms-full.txt").read_text(encoding="utf-8") != full:
            print("STALE: llms-full.txt differs", file=sys.stderr)
            return 2
        print(f"OK {lock['aggregateSourceDigest']}")
        return 0

    AGENTS.mkdir(parents=True, exist_ok=True)
    outputs = {
        "context-lock.json": json.dumps(lock, indent=2) + "\n",
        "llms.txt": index,
        "llms-full.txt": full,
    }
    try:
        with tempfile.TemporaryDirectory(dir=AGENTS.parent) as tmp:
            temp_root = Path(tmp)
            for name, content in outputs.items():
                temp_path = temp_root / name
                temp_path.write_text(content, encoding="utf-8")
            for name in outputs:
                os.replace(temp_root / name, AGENTS / name)
    except OSError as exc:
        print(f"ERROR: unable to publish generated context atomically: {exc}", file=sys.stderr)
        return 2
    print(f"generated {len(lock['sources'])} sources {lock['aggregateSourceDigest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
