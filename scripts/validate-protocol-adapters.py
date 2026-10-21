#!/usr/bin/env python3
"""Validate every bundled protocol adapter without external dependencies."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURRENT_BOOTSTRAP = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
REQUIRED = {"format", "adapterId", "protocol", "supportedBootstrap", "authority", "mappings", "unsupported", "compatibility", "checks", "migration"}
DIMENSIONS = {"syntax", "schema", "behavior", "semantics", "authority", "evidence"}


def main() -> int:
    schema = ROOT / "schemas/protocol-adapter.schema.json"
    if not schema.exists():
        print(f"INVALID: missing {schema}", file=sys.stderr)
        return 2
    adapters = sorted((ROOT / "profiles").glob("*/adapter.json"))
    if not adapters:
        print("OK protocol adapters: none selected")
        return 0
    errors: list[str] = []
    ids: set[str] = set()
    for path in adapters:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path}: {exc}")
            continue
        missing = REQUIRED - set(value)
        if missing:
            errors.append(f"{path}: missing {sorted(missing)}")
        ident = value.get("adapterId")
        if ident in ids:
            errors.append(f"duplicate adapter id: {ident}")
        ids.add(ident)
        protocol = value.get("protocol", {})
        for field in ("id", "version", "revisionOrDigest", "canonicalSource"):
            if not isinstance(protocol.get(field), str) or not protocol[field]:
                errors.append(f"{path}: protocol.{field} is required")
        compatibility = value.get("compatibility", {})
        if set(compatibility) != DIMENSIONS:
            errors.append(f"{path}: compatibility must contain exactly {sorted(DIMENSIONS)}")
        for section in ("imports", "projects", "lifecycle", "evidence"):
            if not isinstance(value.get("mappings", {}).get(section), list):
                errors.append(f"{path}: mappings.{section} must be an array")
        supported = value.get("supportedBootstrap")
        if supported not in {CURRENT_BOOTSTRAP, f"{CURRENT_BOOTSTRAP.rsplit('.', 1)[0]}.x"}:
            errors.append(f"{path}: supportedBootstrap {supported!r} does not cover FPB {CURRENT_BOOTSTRAP}")
    if errors:
        print("INVALID PROTOCOL ADAPTERS", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"OK protocol adapters: {len(adapters)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
