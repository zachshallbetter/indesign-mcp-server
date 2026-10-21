#!/usr/bin/env python3
"""Verify a project's acp-gateway wiring without printing secrets.

Checks, in order and stopping at the first failure:

  gate        GET /health                         liveness; app_configured reported
  auth        GET /internal/app-status            the token is accepted
  owner       GET /internal/projects?owner=       the owner's boards are readable
  board       (from that list)                    the bound board is present and allowed
  notice      GET /notice?owner=&name=            a policy governs this repository (required while the
                                                  profile is failClosed; --allow-ungoverned to downgrade)

Exit codes: 0 ok, 2 configuration missing, 3 gateway refused (body printed), 4 unreachable,
5 not governed (wired, but no ACP policy names this repository).
With --record, appends an evidence record (gate B0-acp) to records/evidence.jsonl.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SECRET_KEYS = ("ACP_GATEWAY_TOKEN",)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        value = value.strip()
        if value[:1] in ('"', "'"):
            value = value[1:].split(value[0], 1)[0]
        else:
            value = value.split(" #", 1)[0].split("\t#", 1)[0].strip()  # inline comment
        values[key] = value
    return values


def settings() -> dict:
    profile = {}
    profile_path = ROOT / "PROJECT_PROFILE.json"
    if profile_path.exists():
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
    acp = profile.get("authorizationProvider", {}) or {}
    url_env = acp.get("gatewayUrlEnv", "ACP_GATEWAY_URL")
    token_env = acp.get("gatewayTokenEnv", "ACP_GATEWAY_TOKEN")
    board_env_file = acp.get("boardEnvFile", ".agents/board.env")

    env = {}
    env.update(load_env_file(ROOT / board_env_file))
    env.update(load_env_file(ROOT / ".env.local"))
    env.update({k: v for k, v in os.environ.items() if k.startswith("ACP_") or k.startswith("GH_PROJECT_")})

    board = acp.get("board") or {}
    owner = env.get("ACP_BOARD_OWNER") or env.get("GH_PROJECT_OWNER") or board.get("owner")
    number = env.get("ACP_BOARD_NUMBER") or env.get("GH_PROJECT_NUMBER") or board.get("number")
    repo_owner, repo_name = git_repo_identity()
    repo_owner = env.get("ACP_REPOSITORY_OWNER") or repo_owner or owner
    repo_name = env.get("ACP_REPOSITORY_NAME") or repo_name
    return {
        "url": (env.get(url_env) or "").rstrip("/"),
        "token": env.get(token_env) or "",
        "owner": owner,
        "number": str(number) if number not in (None, "") else None,
        "repo_owner": repo_owner,
        "repo_name": repo_name,
        "fail_closed": acp.get("failClosed", True) is not False,
        "url_env": url_env,
        "token_env": token_env,
    }


def git_repo_identity() -> tuple[str | None, str | None]:
    """Owner and name of this repository, from origin. The board owner may differ."""
    try:
        remote = subprocess.check_output(
            ["git", "-C", str(ROOT), "remote", "get-url", "origin"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return None, None
    tail = remote.rstrip("/")
    tail = tail[:-4] if tail.endswith(".git") else tail
    parts = tail.replace(":", "/").split("/")
    return (parts[-2], parts[-1]) if len(parts) >= 2 else (None, None)


def scrub(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "<redacted>")
    return text


def call(base: str, path: str, token: str | None, timeout: float) -> tuple[int, dict | str]:
    headers = {"Accept": "application/json", "User-Agent": "fpb-acp-check"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = Request(base + path, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            status = response.status
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        status = exc.code
    except URLError as exc:
        raise ConnectionError(str(exc.reason)) from exc
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def record_evidence(outcome: str, detail: dict) -> None:
    path = ROOT / "records" / "evidence.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "gate": "B0-acp",
        "type": "acp_wiring_check",
        "outcome": outcome,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
        "disposition": "Observed",
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", action="store_true", help="append the result to records/evidence.jsonl")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    parser.add_argument("--allow-ungoverned", action="store_true",
                        help="report a repository no ACP policy governs as a warning, not a failure")
    args = parser.parse_args()

    cfg = settings()
    secrets = [cfg["token"]]
    summary: dict = {"gateway": cfg["url"], "owner": cfg["owner"], "board": cfg["number"], "checks": {}}

    def fail(code: int, check: str, why, body=None) -> int:
        summary["checks"][check] = "FAILED"
        summary["failure"] = {"check": check, "why": scrub(str(why), secrets)}
        if body is not None:
            summary["failure"]["body"] = json.loads(scrub(json.dumps(body), secrets)) if isinstance(body, dict) else scrub(str(body), secrets)
        if args.record:
            record_evidence("FAILED", summary)
        print(json.dumps(summary, indent=2) if args.json else scrub(f"ACP CHECK FAILED at {check}: {why}", secrets), file=sys.stderr)
        if body is not None and not args.json:
            print(scrub(json.dumps(body, indent=2) if isinstance(body, dict) else str(body), secrets), file=sys.stderr)
        return code

    if not cfg["url"]:
        return fail(2, "config", f"{cfg['url_env']} is not set (environment, .env.local or .agents/board.env)")
    if not cfg["token"]:
        return fail(2, "config", f"{cfg['token_env']} is not set; LOCAL_GATEWAY_CREDENTIAL_MISSING is a setup blocker, not a gateway result")
    summary["checks"]["config"] = "OK"

    try:
        status, body = call(cfg["url"], "/health", None, args.timeout)
        if status != 200 or not isinstance(body, dict) or body.get("status") != "ok":
            return fail(3, "health", f"HTTP {status}", body)
        summary["checks"]["health"] = "OK"
        summary["app_configured"] = bool(body.get("app_configured"))

        status, body = call(cfg["url"], "/internal/app-status", cfg["token"], args.timeout)
        if status == 401:
            return fail(3, "auth", "gateway rejected the bearer token", body)
        if status != 200:
            return fail(3, "auth", f"HTTP {status}", body)
        summary["checks"]["auth"] = "OK"

        if cfg["owner"]:
            status, body = call(cfg["url"], "/internal/projects?" + urlencode({"owner": cfg["owner"]}), cfg["token"], args.timeout)
            if status != 200 or not isinstance(body, dict):
                return fail(3, "owner", f"HTTP {status}", body)
            summary["checks"]["owner"] = "OK"
            boards = body.get("projects") or body.get("boards") or []
            summary["boards_visible"] = len(boards)
            if cfg["number"]:
                match = next((b for b in boards if str(b.get("number")) == cfg["number"]), None)
                if match is None:
                    return fail(3, "board", f"board #{cfg['number']} of {cfg['owner']} is not visible to the gateway", body)
                if match.get("allowed") is False:
                    return fail(3, "board", f"board #{cfg['number']} is outside ACP_PROJECT_ALLOWLIST", match)
                summary["checks"]["board"] = "OK"
                summary["board_title"] = match.get("title")
            else:
                summary["checks"]["board"] = "SKIPPED (no board bound)"
        else:
            summary["checks"]["owner"] = "SKIPPED (no owner bound)"
            summary["checks"]["board"] = "SKIPPED (no owner bound)"

        if cfg["repo_owner"] and cfg["repo_name"]:
            resource = f"{cfg['repo_owner']}/{cfg['repo_name']}"
            status, body = call(
                cfg["url"],
                "/notice?" + urlencode({"owner": cfg["repo_owner"], "name": cfg["repo_name"]}),
                None,
                args.timeout,
            )
            if status != 200 or not isinstance(body, dict):
                return fail(3, "notice", f"HTTP {status}", body)
            summary["notice"] = {k: body.get(k) for k in ("governed", "authorization_state", "policy_id", "policy_version", "controlled_operations", "incident_id", "error") if k in body}
            if body.get("governed") is not True:
                why = (f"no ACP policy governs {resource}: inside ACP_POLICY_SCOPE every protected action is "
                       "refused (POLICY_NOT_FOUND); outside it ACP answers ALLOW/NOT_GOVERNED, which "
                       "scripts/acp.py refuses while the profile is failClosed. Register one: "
                       "python3 scripts/acp.py policy > acp-policy.json, then on the gateway: "
                       "scripts/register-policy.py --from acp-policy.json --apply")
                if cfg["fail_closed"] and not args.allow_ungoverned:
                    return fail(5, "notice", why)
                summary["checks"]["notice"] = "WARNING (not governed)"
                summary["warning"] = why
            else:
                summary["checks"]["notice"] = "OK"
        else:
            summary["checks"]["notice"] = "SKIPPED (repository owner or name unknown)"
    except ConnectionError as exc:
        return fail(4, "reach", f"gateway unreachable: {exc}")

    if args.record:
        record_evidence("OK", summary)
    print(json.dumps(summary, indent=2) if args.json else "ACP CHECK OK " + json.dumps(summary["checks"]))
    if summary.get("warning") and not args.json:
        print("WARNING: " + summary["warning"], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
