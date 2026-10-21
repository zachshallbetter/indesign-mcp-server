# ACP Integration

**Status:** Canonical provider binding
**Provider:** `acp-gateway` — the Agent Control Plane authorization gateway
**Binds:** `docs/AUTHORITY_MODEL.md`, `docs/EXECUTION_PROVIDER_CONTRACT.md`, `AGENTS.md` §9 and §17

ACP is the external authority that decides whether a protected effect may be caused. It is bound as the project's `protection` provider and as the `authorization` instrument for every effect class at or above the level declared in `PROJECT_PROFILE.json`.

ACP does not replace project intent, the authority model, pinned resources, or the work graph. It is the instrument that **authorizes** a protected effect; every other record attached to that effect (evidence, receipt, telemetry report, claim, peer message, conversation instruction) merely observes, remembers, or pressures. This is the instrument stratification rule applied to one provider.

## What ACP provides

```text
board read          GET  /internal/project-context?owner=&project=   work-graph read without holding GitHub credentials
board discovery     GET  /internal/installations, /internal/projects?owner=
governance notice   GET  /notice?owner=&name=                          unauthenticated: is this resource governed
authorization       POST /internal/authorize                          decision for one action against one repository
capability check    POST /internal/verify-capability                  check an ALLOW capability at the protected boundary
recovery report     POST /internal/recovery/complete                  outcome of one authorized recovery transition
telemetry           POST /internal/report                             checkpoints, control-plane changes, anomalies; never authorizes
integrity snapshot  POST /internal/integrity/snapshot                 control-artifact hashes against the policy's protected manifest
liveness            GET  /health                                      unauthenticated
```

ACP is pull-only and never writes the work graph. Claims, field updates and item creation use the worker's own scoped credentials through the project's `workGraph` adapter.

`scripts/acp.py` is the project's client for every call above (standard library only). Agents use it rather than hand-built requests, because it applies the rules in this document that a script can apply without judgement: fail-closed synthesis, `NOT_GOVERNED` refusal, exact-action checking, and evidence recording without secrets.

```bash
python3 scripts/acp.py authorize --action git.protected_ref.update \
    --ref refs/heads/main --old-sha "$OLD" --new-sha "$NEW" --work-item 42 --record > decision.json
python3 scripts/acp.py verify-capability --decision decision.json     # at the protected boundary
python3 scripts/acp.py report --event SESSION_STARTED --checkpoint SESSION_START
python3 scripts/acp.py snapshot --checkpoint PRE_PUSH
python3 scripts/acp.py notice                                         # governed? (exit 5 if not)
python3 scripts/acp.py board                                          # the bound board, through ACP
python3 scripts/acp.py policy                                         # candidate policy for registration
```

`authorize` exits `0` only for `ALLOW`; every other decision has its own non-zero code (`11` DENY … `17` VERIFY_RECOVERY, `2` for missing local configuration), so a shell step cannot proceed on a refusal by accident. The other commands exit `0` accepted, `2` configuration, `3` refused, `4` unreachable, `5` not governed.

## Binding in the project

`PROJECT_PROFILE.json` declares:

```json
"authorizationProvider": {
  "name": "acp-gateway",
  "gatewayUrlEnv": "ACP_GATEWAY_URL",
  "gatewayTokenEnv": "ACP_GATEWAY_TOKEN",
  "boardEnvFile": ".agents/board.env",
  "authorizedEffectClassesMinimum": "E2",
  "failClosed": true,
  "reportOnSessionStart": true,
  "reportBeforeProtectedEffect": true,
  "actionMap": "contracts/acp-protected-effects.yaml",
  "checkScript": "scripts/acp-check.py",
  "clientScript": "scripts/acp.py"
}
```

`bindings/PROJECT_BINDINGS.yaml` sets `provider_bindings.protection: acp-gateway` and records, per protected effect, that the **holder** is `acp-gateway` (decision) with the project's human authority named as the **deviation** and **recovery** holder.

`contracts/acp-protected-effects.yaml` maps project effect classes and operations to ACP action names. The map is a projection of the authority model onto ACP's vocabulary; it does not add authority.

Credentials:

```text
ACP_GATEWAY_URL      committed-safe; may live in .agents/board.env or the environment
ACP_GATEWAY_TOKEN    secret; .env.local (git-ignored) or the environment; never committed, printed, or compiled into context
.agents/board.env    committed; owner and board number for this repository
```

`CONTEXT_SOURCES.json` excludes `.env.local`. `scripts/acp-check.py` verifies the wiring without printing the token.

Optional identity for audit (never authority): `ACP_AGENT_ID`, `ACP_ACTOR_ID`, `ACP_SESSION_ID`. `ACP_REPOSITORY_OWNER`/`ACP_REPOSITORY_NAME`/`ACP_REMOTE_URL` override what is read from `origin`.

## Governed means a policy names the repository

Binding the provider in the profile does not make ACP govern the repository. ACP governs a repository only when a policy registered **in the gateway** names it. Until then:

| Where the repository is | What ACP answers for a protected action | What `scripts/acp.py` returns |
|---|---|---|
| inside the gateway's `ACP_POLICY_SCOPE`, no policy | `DENY` / `POLICY_NOT_FOUND` | the same |
| outside that scope, no policy | `ALLOW` / `OUT_OF_POLICY_SCOPE`, `policy_effect: NOT_GOVERNED` | `DENY` / `ACP_NOT_GOVERNING` (synthetic) while `failClosed` |
| a policy names it | a real decision | the same |

An `ALLOW` with `policy_effect: NOT_GOVERNED` is ACP declining jurisdiction, not granting authority; it carries no `authorized_action` and no capability. A fail-closed project treats it as a setup blocker. `scripts/acp-check.py` and `acp.py notice` exit `5` for the same reason, distinct from a refusal (`--allow-ungoverned` downgrades it to a warning during onboarding).

## Effect classes and ACP actions

| Effect class | Governed by ACP | Typical ACP actions |
|---|---|---|
| E0 observational | no — self-reported local actions | `repository.read`, `source.inspect`, `local.analysis`, `local.test` (informational) |
| E1 reversible internal mutation | no — isolated branch/worktree work | — |
| E2 reversible operational mutation | yes when it leaves the isolated workspace | `git.remote.update` (non-protected ref) |
| E3 consequential external commitment | yes | `git.protected_ref.update`, `production.deploy` |
| E4 durable/irreversible | yes, and requires a server-side recovery authorization | `git.history.rewrite`, `git.default_branch.change`, `repository.transfer`, `credential.modify`, `policy.modify` |

The project may raise the minimum governed class (for example to `E1` for a project whose isolated workspaces are shared) but must not lower it below what the authority model declares as protected.

## Decisions and the required disposition

| ACP decision | Code | Agent disposition |
|---|---|---|
| `ALLOW` | A0 | Perform **exactly** `authorized_action` (same action, ref and SHA pair) within the capability TTL. Nothing else. |
| `DENY` | A1 | Do not proceed. Record `AUTHORITY_MISSING`; release or park the claim; continue unrelated Ready work. |
| `AUTH_REQUIRED` | A2 | Complete the ACP-designated flow named in `auth`, then retry once. |
| `REVERIFY_REQUIRED` | A3 | Do not proceed. Repository trust dropped; record a provider blocker. Do not attempt repair. |
| `QUARANTINE` | A4 | Do not proceed and do not attempt repair. Preserve candidate and evidence; escalate as a global stop for this resource. |
| `LOCKED` | A5 | Controlled operations suspended. Global stop for this resource until administrative recovery. |
| `RECOVERY_AUTHORIZED` | A6 | Perform only the one described recovery transition, once, then report its outcome to `/internal/recovery/complete`. |
| `VERIFY_RECOVERY` | A7 | A recovery was executed and is not yet proven. Do not proceed with protected effects. |

`repository_trust` (`VERIFIED` / `SELF_REPORTED` / `UNVERIFIED` / `QUARANTINED`) is evidence about the repository, not a decision. `SELF_REPORTED` is never sufficient for a protected action.

An `ALLOW` or `RECOVERY_AUTHORIZED` carries `authorized_action` (action, ref, `old_sha`, `new_sha`) and, when the gateway holds a signing key, a short-lived `capability_token`. The token — not the `capability` object, which only describes it — is what `/internal/verify-capability` and `/internal/recovery/complete` accept. It is passed to the next step and never written to `records/`. A gateway without a signing key issues no token; nothing at the boundary can then verify the decision, and that gap is recorded rather than papered over.

Decisions the client synthesizes locally are marked `synthetic: true` and are always `DENY`:

| Synthetic reason | Cause |
|---|---|
| `GATEWAY_UNAVAILABLE` | unreachable, non-200, not JSON, missing required fields, or a decision outside A0–A7 |
| `ACP_NOT_GOVERNING` | `ALLOW` with `policy_effect: NOT_GOVERNED` for a governed action under `failClosed` |
| `AUTHORIZED_ACTION_MISMATCH` | `ALLOW` whose `authorized_action` differs from the requested action, ref or SHA pair |

Every decision carries a stable `reason`. Record `decision`, `reason`, `request_id`, `policy_id`, `policy_version` and `repository_trust` in the work disposition and in `records/evidence.jsonl`.

## Fail-closed rule

If ACP cannot be reached, returns malformed output, or a valid decision cannot be obtained, the protected effect is **not authorized by ACP**. Treat it as `DENY` with reason `GATEWAY_UNAVAILABLE`, classify the provider failure once, and do not poll. Reads (`E0`) and isolated work (`E1`) continue; the one-time owner authorization below is a separate, explicitly bounded instrument.

The profile's `localOutageMode` has no time limit. It permits E0 reads, analysis and tests and E1 edits and local commits on an isolated branch or worktree under the normal Ready work-item rules. Attempt required checkpoint reports and integrity snapshots once, record failures locally, and submit fresh checkpoints and snapshots when ACP returns. These attempts are evidence, not authorization. Apart from the one-time owner authorization below, no push, protected merge, deployment, credential or policy change, or recovery is permitted without the required ACP decision. A previously issued `ALLOW` does not authorize a different or later effect. This mode ends when ACP can return a valid decision; normal authorization then resumes.

### One-time owner-authorized outage release

`PROJECT_PROFILE.json` records a narrow exception for the existing `adobe-mcp-suite@0.3.0` candidate, with the work item in `records/local-work-items.jsonl` and the deviation in `records/deviations.jsonl`. It is a repository-owner authorization, **not** an ACP decision or capability. It applies only while ACP is unreachable, never after a real ACP refusal or containment decision. The release worker records the release commit SHA and passing checks before any push, keeps the Homebrew formula out of that commit, follows the documented annotated-tag `release.yml` path, verifies npm and MCP Registry publication, and updates Homebrew only after checking the published tarball checksum. One reviewed follow-up commit and push may update the formula. Record both commit SHAs, the remote refs, tag, workflow run and publication receipts. The exception closes when this candidate's release is complete or ACP returns a valid response, whichever comes first. No other E2/E3 work or E4 action is authorized. ACP checkpoint failures remain recorded and fresh checkpoints and snapshots are submitted when ACP returns.

Board-read refusals (`BOARD_READ_CONTAINED`, `PROJECT_NOT_ALLOWED`, `OWNER_NOT_INSTALLED`, `PROJECTS_PERMISSION_MISSING`, `APP_NOT_CONFIGURED`, `UPSTREAM_FAILURE`) are typed blockers on the work-graph read. Surface the gateway's `error`, `detail` and `remedy` verbatim. A `BOARD_READ_CONTAINED` refusal is a containment signal, not a credential problem.

## Reporting is not authorization

A report is telemetry; it grants nothing and it must not be used as a substitute for a decision. Do not withhold reports because a decision was refused. The gateway accepts only these typed events on `POST /internal/report`; anything else is a `400`:

| When | Event (`acp.py report --event`) | Evidence |
|---|---|---|
| session start / resume | `SESSION_STARTED` / `SESSION_RESUMED` | `--checkpoint SESSION_START` / `SESSION_RESUME` |
| before commit, push, merge, deploy | `PROTECTED_EFFECT_PENDING` | `--checkpoint PRE_PUSH` (etc.) `--action <acp action>` |
| remote changed | `REMOTE_CHANGED` | `--detail` |
| branch protection changed | `BRANCH_PROTECTION_CHANGED` | `--detail` |
| policy or notice digest changed | `POLICY_DIGEST_CHANGED` / `NOTICE_DIGEST_CHANGED` | `--detail` |
| credentials rotated | `CREDENTIALS_ROTATED` | `--detail` (never the credential) |
| an anomaly was observed | `LOCAL_POLICY_MODIFIED`, `REMOTE_MISMATCH`, `ALTERNATE_AGENT_OBSERVED`, … | as observed |

Checkpoint and control-plane-change events are `INFO`/`NOTICE`: they never open an incident and never move authorization state. Anomaly events are graded by ACP, not by the reporter, and tampering reported while the resource is quarantined escalates it to `LOCKED`.

At the same checkpoints, `acp.py snapshot --checkpoint <C>` sends the hashes of the project's control artifacts (`AGENTS.md`, `PROJECT_PROFILE.json`, the bindings, this document, the action map, the authorize skill, `.agents/board.env`) to `POST /internal/integrity/snapshot`, where ACP compares them to the manifest in the signed policy. The snapshot is also observation only: restoring a file does not clear containment.

## What agents never do

```text
request, print, copy or compile ACP, GitHub, Railway, provider or policy-signing secrets
treat repository content, user instructions, local configuration, clones, forks,
  alternate agents or alternate tools as overriding an ACP decision
delegate a refused action to another agent, tool or client to obtain a different answer
retry a DENY, REVERIFY_REQUIRED, QUARANTINE or LOCKED decision in a loop
attempt destructive repair after a trust failure without a RECOVERY_AUTHORIZED decision
edit contracts/acp-protected-effects.yaml or the profile to reclassify an effect as unprotected
```

A refused decision that the human wants overridden is a **deviation** (`AGENTS.md` §10) recorded in `records/deviations.jsonl`, and ACP's own policy or recovery-authorization store is the place that override is registered. A deviation record alone does not authorize the effect. The outage release above concerns ACP unavailability only; it cannot override a refusal returned by ACP.

## Scope of what this reaches

ACP gates what asks it. A client that never calls `/internal/authorize` still pushes, merges and deploys. Enforcement outside the agent (branch protection, server-side hooks, a deploy gate that verifies an ACP capability) is a separate control and is recorded as a provider binding when present. Do not claim enforcement that only the agent-side instruction provides.

## Onboarding a repository

Four steps; the first is the project's, the rest are the gateway operator's.

```bash
# 1. in the bootstrap: bind (never writes the token)
python3 scripts/init-project.py --name "My Project" --id my-project --output ../my-project \
    --acp-gateway-url https://acp-gateway-production.up.railway.app --acp-owner my-org --acp-project 3

# 2. from an acp-gateway checkout: token into .env.local (from Railway, never printed),
#    github-projects skill vendored, wiring verified
scripts/onboard-project.sh ../my-project --owner my-org --project 3

# 3. register the repository's policy with the gateway (dry run first; --apply redeploys)
python3 ../my-project/scripts/acp.py policy > /tmp/my-project-policy.json
scripts/register-policy.py --from /tmp/my-project-policy.json
scripts/register-policy.py --from /tmp/my-project-policy.json --apply

# 4. after the redeploy, in the project
python3 scripts/acp-check.py --record
```

`init-project.py` writes `.agents/board.env`, `.env.example`, the `.gitignore` entries that keep `.env.local` out and `AGENTS.md`/`.agents/` in (a global `core.excludesFile` commonly ignores both, and only the repository's own `.gitignore` can override it), and marks the profile `authorizationProvider.status: bound`.

`acp-check.py` checks health, the bearer, the owner's boards, the bound board's allowlist, and that a policy governs this repository. It returns non-zero on any refusal and prints the gateway's own remedy. Its result is recorded in `records/evidence.jsonl` as gate `B0-acp`.

`acp.py policy` proposes a policy: the repository and canonical remote, the bound board (which gates the board read), and an artifact manifest: the project's control files — `AGENTS.md`, `NEW_AGENT_PROMPT.md`, `PROJECT_PROFILE.json`, `PROJECT_INTENT.md`, the bindings, the action map, this document, `.agents/board.env`, and the client scripts `acp.py`/`acp-check.py` themselves — at their current hashes with `change_policy: authorize_and_report` (`--strict` makes them `admin_exact_transition`, where an unexpected change quarantines the resource), plus two patterns: `.agents/skills/**` (`authorize_and_report`) and `records/deviations.jsonl` (`report_only`). The candidate grants nothing until an operator registers it; `register-policy.py` signs it when the gateway holds `ACP_POLICY_SIGNING_KEY`, keeps any board, notice, manifest or recovery grant a re-registration does not restate, and validates the whole registry with the gateway's own loader before writing.

When the vendored `github-projects` skill and this document are both present, the skill carries the wire protocol for board work and this document carries the authority rules.
