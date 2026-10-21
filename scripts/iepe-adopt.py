#!/usr/bin/env python3
"""Produce a read-only IEPE-to-FPB adoption report."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

def read_json(path: Path) -> dict | None:
    try: value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError): return None
    return value if isinstance(value, dict) else None

def git(project: Path, *args: str) -> str | None:
    try: return subprocess.run(["git", *args], cwd=project, text=True, capture_output=True, check=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError): return None

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--project", default="."); args = parser.parse_args(); project = Path(args.project).resolve()
    reference = read_json(project / ".iepe/protocol-reference.json")
    profile = read_json(project / "PROJECT_PROFILE.json")
    findings: list[dict[str, str]] = []
    if reference is None: findings.append({"severity":"missing", "path":".iepe/protocol-reference.json", "meaning":"IEPE immutable protocol reference is absent"})
    else:
        required = {"protocolId", "protocolVersion", "source", "revision", "relationship", "conformanceCommand"}
        missing = required - set(reference)
        if missing: findings.append({"severity":"error", "path":".iepe/protocol-reference.json", "meaning":f"IEPE reference missing {sorted(missing)}"})
        if reference.get("protocolId") != "IEPE-001": findings.append({"severity":"error", "path":".iepe/protocol-reference.json", "meaning":"protocolId is not IEPE-001"})
        if reference.get("relationship") not in {"reference", "vendored"}: findings.append({"severity":"error", "path":".iepe/protocol-reference.json", "meaning":"relationship must be reference or vendored"})
    if profile is None: findings.append({"severity":"missing", "path":"PROJECT_PROFILE.json", "meaning":"FPB project profile is absent"})
    authority_sources = [path for path in ("INTENT.md", "PROJECT_INTENT.md", "AGENTS.md") if (project / path).exists()]
    if len([path for path in authority_sources if path in {"INTENT.md", "PROJECT_INTENT.md"}]) > 1:
        findings.append({"severity":"review", "path":"INTENT.md/PROJECT_INTENT.md", "meaning":"both IEPE and FPB intent sources exist; retain one declared authority and bind the other as evidence"})
    detected = {"intent": authority_sources, "authority": [path for path in ("AGENTS.md", "PROJECT_PROFILE.json") if (project / path).exists()], "work": [path for path in ("work", "issues", "records") if (project / path).exists()], "evidence": [path for path in ("evidence", "records/evidence.jsonl") if (project / path).exists()]}
    result = {"format":"1", "project":str(project), "git":{"root":git(project,"rev-parse","--show-toplevel"),"head":git(project,"rev-parse","HEAD"),"status":git(project,"status","--short")}, "iepeReference":reference, "fpbProfile":profile, "detected":detected, "findings":findings, "readOnly":True, "nextActions":["approve intent and authority precedence", "bind the immutable IEPE revision in FPB formal resources", "map work, evidence, qualification, and promotion records", "run IEPE conformance command"]}
    print(json.dumps(result, indent=2, sort_keys=True)); return 1 if any(item["severity"] in {"missing", "error"} for item in findings) else 0

if __name__ == "__main__": raise SystemExit(main())
