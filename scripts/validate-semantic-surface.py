#!/usr/bin/env python3
"""Validate an SES/SSS surface projection without granting it domain authority."""
from __future__ import annotations
import json
import sys
from pathlib import Path

FORBIDDEN = {"css", "dom", "component", "layout", "theme", "typography", "mutation", "canonicalStateUpdate"}
DISTINCT_ACCESS = {"available", "unknown", "withheld", "absent", "ineligible"}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-semantic-surface.py SURFACE.json", file=sys.stderr)
        return 2
    try:
        value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    required = {"format", "resolutionId", "sourceState", "purpose", "context", "access", "members", "explanation", "dependencies"}
    errors = [f"missing {sorted(required - set(value))}"] if required - set(value) else []
    if value.get("format") != "1":
        errors.append("format must be 1")
    if value.get("rendererNeutral") is False:
        errors.append("surface must be renderer-neutral")
    if value.get("access") not in DISTINCT_ACCESS:
        errors.append("access must preserve an explicit SSS access state")
    if not isinstance(value.get("members"), list):
        errors.append("members must be an array")
    if not isinstance(value.get("dependencies"), list) or not value.get("dependencies"):
        errors.append("dependencies must identify source and resolver inputs")
    for key in FORBIDDEN:
        if key in value:
            errors.append(f"renderer/domain field is not allowed at surface root: {key}")
    if errors:
        print("INVALID SEMANTIC SURFACE\n" + "\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"OK semantic surface {value['resolutionId']}: {value['access']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
