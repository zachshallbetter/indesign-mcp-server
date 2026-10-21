#!/usr/bin/env python3
"""acp-gateway client for a formal-project-bootstrap project. Standard library only.

    acp.py authorize --action git.protected_ref.update --ref refs/heads/main --old-sha X --new-sha Y
    acp.py report    --event SESSION_STARTED | PROTECTED_EFFECT_PENDING --action A | REMOTE_CHANGED ...
    acp.py snapshot  --checkpoint SESSION_START [--path P ...]
    acp.py verify-capability  --token T      (or --decision decision.json)
    acp.py recovery-complete  --token T --result succeeded|failed --observed-sha S
    acp.py notice              is this repository governed? (exit 5 if not; unauthenticated)
    acp.py board               read the bound ProjectsV2 board through ACP
    acp.py policy              emit this repository's candidate ACP policy (for register-policy.py)

The decision rules live in docs/ACP_INTEGRATION.md; this client applies the
ones a script can apply without judgement:

  * fail closed -- unreachable, refused, malformed or out-of-vocabulary output
    becomes DENY / GATEWAY_UNAVAILABLE (synthetic: true), never a pass;
  * NOT_GOVERNED is not ALLOW -- a governed action that ACP answers with
    policy_effect NOT_GOVERNED (no policy names this repository) is DENY /
    ACP_NOT_GOVERNING while the profile is failClosed;
  * exact action -- an ALLOW whose authorized_action differs from what was
    asked is DENY / AUTHORIZED_ACTION_MISMATCH.

Exit codes for `authorize`: 0 ALLOW, 11 DENY, 12 AUTH_REQUIRED,
13 REVERIFY_REQUIRED, 14 QUARANTINE, 15 LOCKED, 16 RECOVERY_AUTHORIZED,
17 VERIFY_RECOVERY, 2 local configuration missing. Every other command:
0 accepted, 2 configuration, 3 gateway refused, 4 unreachable, 5 not governed.

The gateway token is read from the environment or .env.local and is never
printed or recorded. A capability_token is printed (the next step needs it) but
never written to records/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip() if (ROOT / "VERSION").exists() else "unknown"

DECISIONS = ("ALLOW", "DENY", "AUTH_REQUIRED", "REVERIFY_REQUIRED", "QUARANTINE",
             "LOCKED", "RECOVERY_AUTHORIZED", "VERIFY_RECOVERY")
EXIT = {"ALLOW": 0, "DENY": 11, "AUTH_REQUIRED": 12, "REVERIFY_REQUIRED": 13, "QUARANTINE": 14,
        "LOCKED": 15, "RECOVERY_AUTHORIZED": 16, "VERIFY_RECOVERY": 17}
# E0: never governed, so ACP's answer for them is informational.
LOCAL_ACTIONS = frozenset({"repository.read", "source.inspect", "local.analysis", "local.test"})
REQUIRED = ("decision", "reason", "action", "request_id", "evaluated_at")
CHECKPOINTS = ("SESSION_START", "SESSION_RESUME", "PRE_CONTROLLED_OPERATION", "PRE_COMMIT",
               "PRE_PUSH", "PRE_MERGE", "PRE_DEPLOY", "POST_RECOVERY")
# The bootstrap's own control surface: what an agent would edit to talk itself
# out of a decision. Hashed for snapshots, and proposed as the policy manifest.
# (path, kind, required). The change policy is chosen at `policy` time:
# authorize_and_report by default, admin_exact_transition with --strict.
CONTROL_ARTIFACTS = (
    ("AGENTS.md", "control_instruction", True),
    ("NEW_AGENT_PROMPT.md", "control_instruction", False),
    ("PROJECT_PROFILE.json", "bootstrap", True),
    ("PROJECT_INTENT.md", "bootstrap", True),
    ("bindings/PROJECT_BINDINGS.yaml", "bootstrap", True),
    ("contracts/acp-protected-effects.yaml", "policy_manifest", True),
    ("docs/ACP_INTEGRATION.md", "control_instruction", True),
    (".agents/board.env", "repository_identity", False),
    ("scripts/acp.py", "client_control", True),
    ("scripts/acp-check.py", "client_control", True),
    ("scripts/upgrade-project.py", "client_control", True),
    ("scripts/reconcile-project.py", "client_control", True),
)
# Trees whose every file is governed without being pinned by digest.
CONTROL_PATTERNS = (
    (".agents/skills/**", "client_control_tree", "authorize_and_report"),
    ("records/deviations.jsonl", "control_tree", "report_only"),
)


# ------------------------------------------------------------------ settings

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


def git(*args: str) -> str | None:
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip() or None
    except Exception:
        return None


def owner_and_name(remote: str | None) -> tuple[str | None, str | None]:
    if not remote:
        return None, None
    tail = remote.rstrip("/")
    if tail.endswith(".git"):
        tail = tail[:-4]
    parts = tail.replace(":", "/").split("/")
    return (parts[-2], parts[-1]) if len(parts) >= 2 else (None, None)


def settings() -> dict:
    profile = {}
    if (ROOT / "PROJECT_PROFILE.json").exists():
        profile = json.loads((ROOT / "PROJECT_PROFILE.json").read_text(encoding="utf-8"))
    acp = profile.get("authorizationProvider", {}) or {}
    env: dict[str, str] = {}
    env.update(load_env_file(ROOT / acp.get("boardEnvFile", ".agents/board.env")))
    env.update(load_env_file(ROOT / ".env.local"))
    env.update({k: v for k, v in os.environ.items() if k.startswith(("ACP_", "GH_PROJECT_"))})
    board = acp.get("board") or {}
    remote = env.get("ACP_REMOTE_URL") or git("remote", "get-url", "origin")
    owner, name = owner_and_name(remote)
    return {
        "url": (env.get(acp.get("gatewayUrlEnv", "ACP_GATEWAY_URL")) or "").rstrip("/"),
        "token": env.get(acp.get("gatewayTokenEnv", "ACP_GATEWAY_TOKEN")) or "",
        "token_env": acp.get("gatewayTokenEnv", "ACP_GATEWAY_TOKEN"),
        "fail_closed": acp.get("failClosed", True) is not False,
        "board_owner": env.get("ACP_BOARD_OWNER") or env.get("GH_PROJECT_OWNER") or board.get("owner"),
        "board_number": env.get("ACP_BOARD_NUMBER") or env.get("GH_PROJECT_NUMBER") or board.get("number"),
        "owner": env.get("ACP_REPOSITORY_OWNER") or owner,
        "name": env.get("ACP_REPOSITORY_NAME") or name,
        "remote": remote,
        "agent_id": env.get("ACP_AGENT_ID") or "fpb-agent",
        "actor_id": env.get("ACP_ACTOR_ID"),
        "session_id": env.get("ACP_SESSION_ID"),
        "project_id": profile.get("projectId"),
    }


def scrub(text: str, cfg: dict) -> str:
    return text.replace(cfg["token"], "<redacted>") if cfg.get("token") else text


# ------------------------------------------------------------------ transport

class Unreachable(Exception):
    pass


def call(cfg: dict, method: str, path: str, body: dict | None = None, auth: bool = True,
         timeout: float = 15.0) -> tuple[int, object]:
    headers = {"Accept": "application/json", "User-Agent": f"fpb-acp/{VERSION}"}
    data = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
    if auth:
        headers["Authorization"] = "Bearer " + cfg["token"]
    request = Request(cfg["url"] + path, data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read().decode("utf-8", "replace")
    except HTTPError as exc:
        status, raw = exc.code, exc.read().decode("utf-8", "replace")
    except (URLError, TimeoutError, OSError) as exc:
        raise Unreachable(str(getattr(exc, "reason", exc))) from exc
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def principal(cfg: dict) -> dict:
    out = {"agent_id": cfg["agent_id"], "client_type": "formal-project-bootstrap",
           "client_version": VERSION}
    if cfg["actor_id"]:
        out["actor_id"] = cfg["actor_id"]
    if cfg["session_id"]:
        out["session_id"] = cfg["session_id"]
    return out


def resource(cfg: dict, ref: str | None = None) -> dict:
    out = {k: v for k, v in (("owner", cfg["owner"]), ("name", cfg["name"]),
                              ("remote_url", cfg["remote"]), ("ref", ref)) if v}
    return out


def require(cfg: dict, repository: bool = False) -> str | None:
    if not cfg["url"]:
        return "ACP_GATEWAY_URL is not set (environment, .env.local or .agents/board.env)"
    if not cfg["token"]:
        return f"{cfg['token_env']} is not set: LOCAL_GATEWAY_CREDENTIAL_MISSING (a setup blocker)"
    if repository and not (cfg["owner"] and cfg["name"]):
        return "repository owner/name unknown: set an origin remote or ACP_REPOSITORY_OWNER/NAME"
    return None


def emit(value: object, cfg: dict, stream=sys.stdout) -> None:
    print(scrub(json.dumps(value, indent=2, sort_keys=True), cfg), file=stream)


def record_evidence(entry: dict) -> None:
    path = ROOT / "records" / "evidence.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {k: v for k, v in entry.items() if k not in ("capability_token", "capability")}
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")


# ------------------------------------------------------------------ authorize

def synthetic(action: str, reason: str, detail: str, **extra) -> dict:
    return {"decision": "DENY", "code": "A1", "reason": reason, "action": action,
            "request_id": "local-" + uuid.uuid4().hex[:16],
            "evaluated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "detail": detail, "synthetic": True, **extra}


def dispose(action: str, asked: dict, status: int, body: object, fail_closed: bool) -> dict:
    """Turn whatever came back into one decision, failing closed."""
    if not isinstance(body, dict):
        return synthetic(action, "GATEWAY_UNAVAILABLE", f"HTTP {status}: response was not JSON")
    if status != 200:
        return synthetic(action, "GATEWAY_UNAVAILABLE",
                         f"HTTP {status}: {body.get('error')}: {body.get('detail')}",
                         gateway_error=body.get("error"), remedy=body.get("remedy"))
    missing = [field for field in REQUIRED if not body.get(field)]
    if missing or body.get("decision") not in DECISIONS:
        return synthetic(action, "GATEWAY_UNAVAILABLE",
                         f"malformed decision (missing {missing or 'valid decision'})")
    if body["decision"] != "ALLOW" or action in LOCAL_ACTIONS:
        return body
    if body.get("policy_effect") == "NOT_GOVERNED":
        if not fail_closed:
            return body
        return synthetic(action, "ACP_NOT_GOVERNING",
                         "ACP answered ALLOW because no policy governs this repository "
                         f"({body.get('reason')}). The profile is fail-closed, so that is not an "
                         "authorization. Register one: acp.py policy > p.json; register-policy.py --from p.json.",
                         gateway_decision={k: body.get(k) for k in ("decision", "reason", "policy_effect",
                                                                    "request_id")})
    granted = body.get("authorized_action") or {}
    for field in ("action", "ref", "old_sha", "new_sha"):
        wanted = action if field == "action" else asked.get(field)
        if wanted is not None and granted.get(field) != wanted:
            return synthetic(action, "AUTHORIZED_ACTION_MISMATCH",
                             f"ALLOW authorized {field}={granted.get(field)!r}, not {wanted!r}",
                             gateway_decision={k: body.get(k) for k in ("decision", "reason", "request_id")})
    return body


def cmd_authorize(args, cfg) -> int:
    problem = require(cfg, repository=True)
    context = {k: v for k, v in (("ref", args.ref), ("old_sha", args.old_sha),
                                 ("new_sha", args.new_sha)) if v}
    if args.force:
        context["force"] = True
    if args.recovery_authorization_id:
        context["recovery_authorization_id"] = args.recovery_authorization_id
    if problem:
        decision = synthetic(args.action, "GATEWAY_UNAVAILABLE", problem, local_setup=True)
    else:
        claim = {k: v for k, v in (("owner", cfg["owner"]), ("name", cfg["name"]),
                                   ("remote_url", cfg["remote"]),
                                   ("head_sha", git("rev-parse", "HEAD"))) if v}
        request = {"action": args.action, "agent_id": cfg["agent_id"], "repository_claim": claim,
                   "context": context,
                   "principal": {k: v for k, v in principal(cfg).items()
                                 if k in ("client_type", "client_version")}}
        for key in ("actor_id", "session_id"):
            if cfg[key]:
                request[key] = cfg[key]
        if args.summary:
            request["request_provenance"] = {"source": args.provenance, "request_summary": args.summary}
        try:
            status, body = call(cfg, "POST", "/internal/authorize", request, timeout=args.timeout)
            decision = dispose(args.action, context, status, body, cfg["fail_closed"])
        except Unreachable as exc:
            decision = synthetic(args.action, "GATEWAY_UNAVAILABLE", f"unreachable: {exc}")
    if args.record:
        record_evidence({"gate": "acp-decision", "type": "acp_authorization", "disposition": "Observed",
                         "observedAt": datetime.now(timezone.utc).isoformat(),
                         "workItem": args.work_item, "context": context,
                         **{k: decision.get(k) for k in ("decision", "code", "reason", "action", "request_id",
                                                         "policy_id", "policy_version", "repository_trust",
                                                         "authorization_state", "incident_id", "synthetic")}})
    emit(decision, cfg)
    if problem:
        return 2
    return EXIT.get(decision["decision"], 11)


# ------------------------------------------------------------------ others

def post(cfg, path, body, args) -> int:
    try:
        status, reply = call(cfg, "POST", path, body, timeout=args.timeout)
    except Unreachable as exc:
        print(f"ACP unreachable: {exc}", file=sys.stderr)
        return 4
    emit(reply, cfg, sys.stdout if status == 200 else sys.stderr)
    return 0 if status == 200 else 3


def cmd_report(args, cfg) -> int:
    problem = require(cfg, repository=True)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    evidence = {k: v for k, v in (("checkpoint", args.checkpoint), ("action", args.action),
                                  ("detail", args.detail)) if v}
    if args.path:                                   # the file the event is about, with its digest
        evidence["path"] = args.path
        seen = observe(args.path)
        if seen.get("sha256"):
            evidence["current_sha256"] = seen["sha256"]
    body = {"event_type": args.event, "event_id": "fpb-" + uuid.uuid4().hex[:16],
            "observed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "principal": principal(cfg), "resource": resource(cfg, args.ref)}
    if evidence:
        body["evidence"] = evidence
    return post(cfg, "/internal/report", body, args)


def observe(path: str) -> dict:
    target = ROOT / path
    if target.is_symlink():
        return {"path": path, "state": "present", "symlink": True}
    if not target.exists():
        return {"path": path, "state": "missing"}
    try:
        data = target.read_bytes()
    except OSError:
        return {"path": path, "state": "unreadable"}
    return {"path": path, "state": "present", "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}


def cmd_snapshot(args, cfg) -> int:
    problem = require(cfg, repository=True)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    paths = args.path or [path for path, _, _ in CONTROL_ARTIFACTS]
    repository = {k: v for k, v in (("remote_url", cfg["remote"]), ("head_sha", git("rev-parse", "HEAD")),
                                    ("branch", git("rev-parse", "--abbrev-ref", "HEAD"))) if v}
    status = git("status", "--porcelain")
    repository["dirty"] = bool(status)
    body = {"checkpoint": args.checkpoint, "principal": principal(cfg), "resource": resource(cfg),
            "repository": repository, "artifacts": [observe(p) for p in paths]}
    return post(cfg, "/internal/integrity/snapshot", body, args)


def token_from(args) -> str | None:
    if args.token:
        return args.token
    if args.decision:
        source = sys.stdin if args.decision == "-" else open(args.decision, encoding="utf-8")
        with source:
            return (json.load(source) or {}).get("capability_token")
    return None


def cmd_notice(args, cfg) -> int:
    """Is this repository governed? Unauthenticated, like the gateway endpoint."""
    if not cfg["url"]:
        print("ACP_GATEWAY_URL is not set (environment, .env.local or .agents/board.env)", file=sys.stderr)
        return 2
    if not (cfg["owner"] and cfg["name"]):
        print("repository owner/name unknown: set an origin remote or ACP_REPOSITORY_OWNER/NAME", file=sys.stderr)
        return 2
    try:
        status, reply = call(cfg, "GET", "/notice?" + urlencode({"owner": cfg["owner"], "name": cfg["name"]}),
                             auth=False, timeout=args.timeout)
    except Unreachable as exc:
        print(f"ACP unreachable: {exc}", file=sys.stderr)
        return 4
    emit(reply, cfg, sys.stdout if status == 200 else sys.stderr)
    if status != 200 or not isinstance(reply, dict):
        return 3
    if reply.get("governed") is not True:
        print("NOT GOVERNED: no active ACP policy names this repository. Register one: "
              "scripts/acp.py policy > p.json, then acp-gateway scripts/register-policy.py --from p.json",
              file=sys.stderr)
        return 0 if args.allow_ungoverned else 5
    return 0


def cmd_verify(args, cfg) -> int:
    problem = require(cfg)
    token = token_from(args)
    if problem or not token:
        print(problem or "no capability_token (ALLOW without a signing key carries none)", file=sys.stderr)
        return 2
    return post(cfg, "/internal/verify-capability", {"capability_token": token}, args)


def cmd_recovery_complete(args, cfg) -> int:
    problem = require(cfg)
    token = token_from(args)
    if problem or not token:
        print(problem or "no capability_token", file=sys.stderr)
        return 2
    body = {"capability_token": token, "result": args.result}
    if args.observed_sha:
        body["observed_sha"] = args.observed_sha
    if args.detail:
        body["detail"] = args.detail
    return post(cfg, "/internal/recovery/complete", body, args)


def cmd_board(args, cfg) -> int:
    problem = require(cfg)
    if problem or not (cfg["board_owner"] and cfg["board_number"]):
        print(problem or "no board bound (.agents/board.env ACP_BOARD_OWNER/ACP_BOARD_NUMBER)", file=sys.stderr)
        return 2
    try:
        status, reply = call(cfg, "GET", "/internal/project-context?" + urlencode(
            {"owner": cfg["board_owner"], "project": cfg["board_number"]}), timeout=max(args.timeout, 60))
    except Unreachable as exc:
        print(f"ACP unreachable: {exc}", file=sys.stderr)
        return 4
    emit(reply, cfg, sys.stdout if status == 200 else sys.stderr)
    return 0 if status == 200 else 3


def cmd_policy(args, cfg) -> int:
    """The candidate an operator registers with ACP. This file grants nothing."""
    if not (cfg["owner"] and cfg["name"]):
        print("repository owner/name unknown: set an origin remote or ACP_REPOSITORY_OWNER/NAME", file=sys.stderr)
        return 2
    policy = {"policy_id": args.policy_id or f"{cfg['owner']}-{cfg['name']}".lower(), "version": 1,
              "status": "active",
              "repository": {"owner": cfg["owner"], "name": cfg["name"],
                             "canonical_remote": f"https://github.com/{cfg['owner']}/{cfg['name']}.git"}}
    if cfg["board_owner"] and cfg["board_number"]:
        policy["boards"] = [{"owner": cfg["board_owner"], "number": int(cfg["board_number"])}]
    if not args.no_manifest:
        change = "admin_exact_transition" if args.strict else "authorize_and_report"
        artifacts = []
        for path, kind, required in CONTROL_ARTIFACTS:
            seen = observe(path)
            if seen["state"] != "present" or "sha256" not in seen:
                continue
            artifacts.append({"id": path.replace("/", "-").lower(), "path": path, "kind": kind,
                              "required": required, "expected_sha256": seen["sha256"], "change_policy": change})
        branch = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
        default = branch.split("/", 1)[1] if branch and "/" in branch else "main"
        patterns = [{"id": glob.replace("/", "-").replace("*", "").strip("-").lower(), "pattern": glob,
                     "kind": kind, "change_policy": policy_for}
                    for glob, kind, policy_for in CONTROL_PATTERNS]
        policy["artifact_manifest"] = {"artifact_manifest_version": 1, "artifacts": artifacts, "patterns": patterns,
                                       "refs": [{"ref": f"refs/heads/{default}", "kind": "protected_ref",
                                                 "verification": "provider_required"}]}
    print(json.dumps(policy, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--timeout", type=float, default=15.0)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("authorize", help="obtain a decision for one governed effect")
    p.add_argument("--action", required=True)
    p.add_argument("--ref")
    p.add_argument("--old-sha")
    p.add_argument("--new-sha")
    p.add_argument("--force", action="store_true")
    p.add_argument("--recovery-authorization-id")
    p.add_argument("--work-item", help="recorded with the decision")
    p.add_argument("--summary", help="bounded summary of why (never the prompt)")
    p.add_argument("--provenance", default="automation",
                   choices=("interactive_user", "repository_instruction", "issue_comment",
                            "pull_request_comment", "tool_output", "secondary_agent", "automation",
                            "ci", "unknown"))
    p.add_argument("--record", action="store_true", help="append to records/evidence.jsonl")
    p.set_defaults(fn=cmd_authorize)

    p = sub.add_parser("report", help="telemetry; never authorizes")
    p.add_argument("--event", required=True)
    p.add_argument("--checkpoint", choices=CHECKPOINTS)
    p.add_argument("--action")
    p.add_argument("--ref")
    p.add_argument("--detail")
    p.add_argument("--path", help="the file this event concerns; its current sha256 is attached")
    p.set_defaults(fn=cmd_report)

    p = sub.add_parser("snapshot", help="observed control-artifact state at a checkpoint")
    p.add_argument("--checkpoint", required=True, choices=CHECKPOINTS)
    p.add_argument("--path", action="append", help="default: the bootstrap's control artifacts")
    p.set_defaults(fn=cmd_snapshot)

    for name, fn in (("verify-capability", cmd_verify), ("recovery-complete", cmd_recovery_complete)):
        p = sub.add_parser(name)
        p.add_argument("--token")
        p.add_argument("--decision", help="a saved authorize output, or - for stdin")
        if name == "recovery-complete":
            p.add_argument("--result", required=True, choices=("succeeded", "failed"))
            p.add_argument("--observed-sha")
            p.add_argument("--detail")
        p.set_defaults(fn=fn)

    p = sub.add_parser("notice", help="is this repository governed (exit 5 if not)")
    p.add_argument("--allow-ungoverned", action="store_true")
    p.set_defaults(fn=cmd_notice)

    p = sub.add_parser("board", help="read the bound board through ACP")
    p.set_defaults(fn=cmd_board)

    p = sub.add_parser("policy", help="emit the candidate ACP policy for this repository")
    p.add_argument("--policy-id")
    p.add_argument("--strict", action="store_true",
                   help="control artifacts change only by admin transition (material on change)")
    p.add_argument("--no-manifest", action="store_true")
    p.set_defaults(fn=cmd_policy)

    args = parser.parse_args()
    return args.fn(args, settings())


if __name__ == "__main__":
    raise SystemExit(main())
