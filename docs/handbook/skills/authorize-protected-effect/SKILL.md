---
name: authorize-protected-effect
description: Use before a governed effect when the project profile binds an authorization provider. Resolve and follow that provider's action map and decision contract; this repository's concrete adapter is acp-gateway.
---

# Authorize Protected Effect

## Requirements

Use in a project with a bound authorization provider, an action map, and a documented decision contract. The ACP commands below require that project's `scripts/acp.py` and integration docs; they are not included in this skill bundle.

For this repository's one-time `adobe-mcp-suite@0.3.0` outage release only, first read `PROJECT_PROFILE.json` `outageReleaseAuthorization`, `records/local-work-items.jsonl`, `records/deviations.jsonl`, and `docs/ACP_INTEGRATION.md` § One-time owner-authorized outage release. When ACP is unreachable, that recorded owner authorization permits only its named candidate and effects; record the final commit SHA, checks and remote receipts. Never treat a synthetic ACP `DENY` as `ALLOW`, and never use the exception after a real ACP response or for another candidate. All other governed effects follow the steps below.

1. Read the active project's `authorizationProvider` binding and effect map. For this repository's ACP adapter, resolve the operation through `contracts/acp-protected-effects.yaml`. If the effect is not governed, proceed only under the work item's permissions.
2. Identify: repository (from `origin`), ref, current (`old_sha`) and intended (`new_sha`) revision, requested action, work item, claim.
3. Send the provider only fields required by its documented authorization contract. Never include prompts, source contents, unrelated user data, or credentials in a request, report, or evidence record.
4. Use only the credentials and authorization interface named by the active provider. In this repository, `scripts/acp.py` reads credentials from the environment or `.env.local`. Never print, log, or compile credentials.
5. Follow the provider's report-before-effect requirement. For this repository's ACP adapter, when `reportBeforeProtectedEffect` is true, run `python3 scripts/acp.py report --event PROTECTED_EFFECT_PENDING --checkpoint PRE_PUSH --action <action>` (use the matching `PRE_*` checkpoint), then `python3 scripts/acp.py snapshot --checkpoint PRE_PUSH`. Reporting grants nothing.
6. Request a decision for the exact action, target and revision using the bound provider. For ACP, run `python3 scripts/acp.py authorize --action <action> [--ref R --old-sha X --new-sha Y] --work-item <id> --record > decision.json`; proceed only when its typed decision is `ALLOW`. For another provider, use its documented explicit allow result and scope.
7. Dispose according to the provider's documented decision contract. For ACP, use `decision` and `reason`:
   - `ALLOW` → perform exactly `authorized_action` (same action/ref/SHA), once, within the capability TTL. Where the boundary checks, `python3 scripts/acp.py verify-capability --decision decision.json`. Then re-read live state.
   - `AUTH_REQUIRED` → complete the flow named in `auth`; retry once.
   - `RECOVERY_AUTHORIZED` → perform only the described transition, once; then `python3 scripts/acp.py recovery-complete --decision decision.json --result succeeded|failed --observed-sha <sha>`.
   - `DENY` / `REVERIFY_REQUIRED` / `VERIFY_RECOVERY` → do not proceed; record `AUTHORITY_MISSING` with the reason; release or park the claim; reselect.
   - `QUARANTINE` / `LOCKED` → do not proceed and do not repair; preserve candidate and evidence; global stop for this resource; prepare the decision packet.
   - `synthetic: true` → the ACP client refused locally. `GATEWAY_UNAVAILABLE`: classify once, do not poll. `ACP_NOT_GOVERNING`: no policy names this repository; use the setup path in `docs/ACP_INTEGRATION.md` § Onboarding, not as permission to proceed. `AUTHORIZED_ACTION_MISMATCH`: do not perform either action.
8. Record the provider decision and required provenance in the project's evidence store and work disposition. For ACP, `--record` writes `decision`, `reason`, `request_id`, `policy_id`, `policy_version`, and `repository_trust` to `records/evidence.jsonl`. Never record `capability_token`.

If no authorization provider is bound, its contract is unavailable, or the provider cannot return a valid decision, do not perform a governed effect except for the one-time owner release recorded above while ACP is unreachable. Record the blocker and follow the project's recovery/escalation path; never substitute a different provider, local judgment, or delegation to another agent, tool, clone, or client.
