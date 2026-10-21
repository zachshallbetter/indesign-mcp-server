#!/usr/bin/env python3
"""Plan, apply, verify, and roll back a non-destructive bootstrap upgrade."""

from __future__ import annotations

import argparse
import fcntl
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPGRADE_DIR = ".formal-bootstrap/upgrades"


class UpgradeError(RuntimeError):
    pass


def load_initializer(release: Path):
    path = release / "scripts/init-project.py"
    spec = importlib.util.spec_from_file_location("bootstrap_initializer", path)
    if spec is None or spec.loader is None:
        raise UpgradeError(f"initializer missing from release: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def version(release: Path) -> str:
    try:
        value = (release / "VERSION").read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise UpgradeError(f"cannot read release VERSION: {exc}") from exc
    if not value:
        raise UpgradeError(f"release VERSION is empty: {release}")
    return value


def validate_release(release: Path) -> None:
    required = ["VERSION", "scripts/init-project.py", "scripts/gen-context.py", "scripts/validate-bootstrap.py"]
    missing = [rel for rel in required if not (release / rel).is_file()]
    if missing:
        raise UpgradeError(f"release is incomplete; missing: {', '.join(missing)}")


def project_identity(project: Path) -> tuple[str, str, str]:
    marker_path = project / ".formal-bootstrap.json"
    profile_path = project / "PROJECT_PROFILE.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpgradeError(f"project bootstrap metadata is unreadable: {exc}") from exc
    project_id = str(marker.get("projectId") or profile.get("projectId") or "")
    project_name = str(marker.get("projectName") or profile.get("projectName") or "")
    installed = str(marker.get("bootstrapVersion") or profile.get("profileVersion") or "")
    if not project_id or not project_name or not installed:
        raise UpgradeError("project metadata must contain projectId, projectName, and bootstrapVersion")
    return project_id, project_name, installed


def read(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() else None


def merge_defaults(default: object, current: object) -> object:
    if isinstance(default, dict) and isinstance(current, dict):
        merged = {key: merge_defaults(value, current[key]) if key in current else value
                  for key, value in default.items()}
        merged.update({key: value for key, value in current.items() if key not in merged})
        return merged
    return current


def source_map(
    release: Path, project: Path, project_id: str, project_name: str
) -> dict[str, bytes]:
    initializer = load_initializer(release)
    result: dict[str, bytes] = {}

    for rel in initializer.COPY_FILES:
        result[rel] = (release / rel).read_bytes()
    for rel in initializer.COPY_DIRS:
        source = release / rel
        for path in sorted(source.rglob("*")):
            if path.is_file():
                result[str(Path(rel) / path.relative_to(source))] = path.read_bytes()
    for name in initializer.COPY_DOCS:
        result[f"docs/{name}"] = (release / "docs" / name).read_bytes()
    for name in initializer.SCRIPT_FILES:
        result[f"scripts/{name}"] = (release / "scripts" / name).read_bytes()

    result["VERSION"] = (release / "VERSION").read_bytes()
    result["PROJECT_INTENT.md"] = (release / "PROJECT_INTENT_TEMPLATE.md").read_text(
        encoding="utf-8"
    ).replace("<PROJECT_ID>", project_id).replace("<PROJECT_NAME>", project_name).encode()

    profile = json.loads((release / "PROJECT_PROFILE_TEMPLATE.json").read_text(encoding="utf-8"))
    current_profile = json.loads((project / "PROJECT_PROFILE.json").read_text(encoding="utf-8"))
    profile = merge_defaults(profile, current_profile)
    profile["projectId"] = project_id
    profile["projectName"] = project_name
    profile["profileVersion"] = version(release)
    result["PROJECT_PROFILE.json"] = (json.dumps(profile, indent=2) + "\n").encode()
    context_policy = json.loads(
        (release / "CONTEXT_SOURCES_TEMPLATE.json").read_text(encoding="utf-8")
    )
    result["CONTEXT_SOURCES.json"] = (json.dumps(context_policy, indent=2) + "\n").encode()
    result["FORMAL_RESOURCE_MANIFEST.json"] = (release / "FORMAL_RESOURCE_MANIFEST_TEMPLATE.json").read_text(
        encoding="utf-8"
    ).replace("<PROJECT_ID>", project_id).replace("<PROJECT_NAME>", project_name).encode()
    result["bindings/PROJECT_BINDINGS.yaml"] = (release / "bindings/PROJECT_BINDINGS_TEMPLATE.yaml").read_text(
        encoding="utf-8"
    ).replace("<PROJECT_ID>", project_id).replace("<PROJECT_NAME>", project_name).encode()
    return result


def classify(project: Path, target: dict[str, bytes], base: Path | None) -> dict:
    safe: list[str] = []
    conflicts: list[str] = []
    unchanged: list[str] = []
    additions: list[str] = []
    preserved: list[str] = []
    always_safe = {"PROJECT_PROFILE.json"}

    for rel, desired in sorted(target.items()):
        current = read(project / rel)
        if current == desired:
            unchanged.append(rel)
            continue
        if current is None:
            additions.append(rel)
            safe.append(rel)
            continue
        if rel in always_safe:
            safe.append(rel)
            continue
        if base is not None and read(base / rel) == current:
            safe.append(rel)
            continue
        if base is not None and read(base / rel) == desired:
            preserved.append(rel)
            continue
        conflicts.append(rel)

    removed: list[str] = []
    if base is not None:
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(base).as_posix()
            if rel in target or read(project / rel) != path.read_bytes():
                continue
            removed.append(rel)

    return {
        "safe": safe,
        "additions": additions,
        "unchanged": unchanged,
        "preserved": preserved,
        "conflicts": conflicts,
        "removedCandidates": removed,
    }


def plan(project: Path, release: Path, base: Path | None) -> dict:
    validate_release(release)
    project_id, project_name, installed = project_identity(project)
    target_version = version(release)
    if installed == target_version:
        raise UpgradeError(f"project already reports bootstrap version {target_version}")
    target = source_map(release, project, project_id, project_name)
    result = classify(project, target, base)
    return {
        "format": "1",
        "bootstrap": "formal-project-bootstrap",
        "fromVersion": installed,
        "toVersion": target_version,
        "project": str(project),
        "release": str(release),
        "base": str(base) if base else None,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "classification": result,
        "targetFiles": sorted(target),
    }


def write_candidate(project: Path, release_version: str, rel: str, content: bytes) -> Path:
    path = project / UPGRADE_DIR / release_version / "candidates" / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def apply_plan(project: Path, release: Path, plan_data: dict) -> None:
    if plan_data["classification"]["conflicts"] or plan_data["classification"]["removedCandidates"]:
        project_id, project_name, _ = project_identity(project)
        target = source_map(release, project, project_id, project_name)
        for rel in plan_data["classification"]["conflicts"]:
            write_candidate(project, plan_data["toVersion"], rel, target[rel])
        raise UpgradeError("critical or ambiguous changes remain; resolve the plan before applying")
    project_id, project_name, _ = project_identity(project)
    target = source_map(release, project, project_id, project_name)
    release_version = plan_data["toVersion"]
    upgrade_root = project / UPGRADE_DIR / release_version
    backup = upgrade_root / "backup"
    backup.mkdir(parents=True, exist_ok=True)
    changed = plan_data["classification"]["safe"]
    try:
        marker_path = project / ".formal-bootstrap.json"
        shutil.copy2(marker_path, backup / ".formal-bootstrap.json")
        for rel in changed:
            current = project / rel
            if current.exists():
                destination = backup / rel
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(current, destination)
        for rel in changed:
            destination = project / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as tmp:
                tmp.write(target[rel])
                temp_name = Path(tmp.name)
            os.replace(temp_name, destination)

        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        marker["bootstrapVersion"] = release_version
        marker["lastUpgrade"] = {"fromVersion": plan_data["fromVersion"], "toVersion": release_version}
        marker_path.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
        record = upgrade_root / "upgrade-plan.json"
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text(json.dumps(plan_data, indent=2) + "\n", encoding="utf-8")
        subprocess.check_call([sys.executable, str(project / "scripts/gen-context.py")], cwd=project)
        subprocess.check_call(
            [sys.executable, str(project / "scripts/validate-bootstrap.py"), "--check-context"], cwd=project
        )
    except Exception:
        rollback(project, release_version)
        raise


def rollback(project: Path, release_version: str) -> None:
    backup = project / UPGRADE_DIR / release_version / "backup"
    if not backup.exists():
        raise UpgradeError(f"upgrade backup not found for {release_version}")
    plan_path = project / UPGRADE_DIR / release_version / "upgrade-plan.json"
    plan_data = json.loads(plan_path.read_text(encoding="utf-8")) if plan_path.exists() else None
    if plan_data:
        for rel in plan_data["classification"]["additions"]:
            destination = project / rel
            if destination.exists():
                destination.unlink()
    for path in sorted(backup.rglob("*")):
        if path.is_file():
            rel = path.relative_to(backup)
            destination = project / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    generator = project / "scripts/gen-context.py"
    validator = project / "scripts/validate-bootstrap.py"
    if generator.exists() and validator.exists():
        subprocess.check_call([sys.executable, str(generator)], cwd=project)
        subprocess.check_call([sys.executable, str(validator), "--check-context"], cwd=project)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(ROOT))
    parser.add_argument("--from", dest="release", required=True, help="target bootstrap release directory")
    parser.add_argument("--base", help="previous bootstrap release directory for three-way comparison")
    parser.add_argument("--check", "--plan", action="store_true", dest="check")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    project = Path(args.project).resolve()
    release = Path(args.release).resolve()
    base = Path(args.base).resolve() if args.base else None
    lock_path = project / UPGRADE_DIR / ".lock"
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("w", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            return run_locked(args, project, release, base)
    except (OSError, subprocess.CalledProcessError, UpgradeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


def run_locked(args, project: Path, release: Path, base: Path | None) -> int:
    try:
        if args.verify:
            subprocess.check_call([sys.executable, str(project / "scripts/validate-bootstrap.py"), "--check-context"], cwd=project)
            return 0
        if args.rollback:
            marker = json.loads((project / ".formal-bootstrap.json").read_text(encoding="utf-8"))
            upgrade = marker.get("lastUpgrade") or {}
            target_version = str(upgrade.get("toVersion") or "")
            if not target_version:
                raise UpgradeError("project has no recorded upgrade to roll back")
            rollback(project, target_version)
            return 0
        plan_data = plan(project, release, base)
        path = project / UPGRADE_DIR / plan_data["toVersion"] / "plan.json"
        if args.apply:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(plan_data, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(plan_data, indent=2))
        if args.apply:
            apply_plan(project, release, plan_data)
            print(f"applied bootstrap upgrade to {plan_data['toVersion']}")
            return 0
        if not args.check:
            print("plan only; pass --apply to mutate the project", file=sys.stderr)
        return 3 if plan_data["classification"]["conflicts"] else 0
    except (OSError, subprocess.CalledProcessError, UpgradeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
