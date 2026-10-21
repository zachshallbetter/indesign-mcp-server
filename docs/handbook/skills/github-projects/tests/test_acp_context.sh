#!/usr/bin/env bash
#
# test_acp_context.sh — the gateway's advice must reach the caller.
#
# A refusal from the ACP gateway carries the fix (error code, remedy, the
# owners it can read, the allowlist entry to add). `curl -f` discarded that
# body, so the agent saw only a failed command. These cover both halves: a good
# read still passes through untouched, and a refusal is explained and fatal.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
STUB="$(mktemp -d)"; trap 'rm -rf "$STUB"' EXIT
PATH="$STUB:$PATH"
fails=0

# A stub curl: prints the canned body, then the status, matching -w '\n%{http_code}'.
stub_curl() {
  cat > "$STUB/curl" <<STUBEOF
#!/usr/bin/env bash
cat <<'BODY'
$1
BODY
printf '%s' '$2'
STUBEOF
  chmod +x "$STUB/curl"
}

check() { # <name> <condition-description> <actual> <expected-substring>
  case "$3" in *"$4"*) echo "  ok $1";; *) echo "  FAIL $1: expected $2 in: $3"; fails=$((fails+1));; esac
}

export ACP_GATEWAY_URL="https://gateway.invalid" ACP_GATEWAY_TOKEN="t"
export GH_PROJECT_OWNER=testowner GH_PROJECT_NUMBER=7
. scripts/lib.sh
gp_resolve

# 1. a good read passes the body through unchanged
stub_curl '{"snapshot":{"number":7},"allowed":true}' 200
out="$(gp_acp_context)"; code=$?
check "success returns the body" "the snapshot" "$out" '"number":7'
[ "$code" = 0 ] && echo "  ok success exits 0" || { echo "  FAIL success exit $code"; fails=$((fails+1)); }

# 2. a refusal is explained on stderr, not swallowed
stub_curl '{"error":"PROJECT_NOT_ALLOWED","detail":"Board #7 of '"'"'testowner'"'"' is outside this gateway'"'"'s allowlist.","remedy":"Add it to ACP_PROJECT_ALLOWLIST on the deployment.","allowlist":"2-9,11"}' 403
err="$(gp_acp_context 2>&1 >/dev/null)"; code=$?
check "refusal names the code"    "PROJECT_NOT_ALLOWED" "$err" "PROJECT_NOT_ALLOWED"
check "refusal carries the remedy" "the remedy"          "$err" "ACP_PROJECT_ALLOWLIST"
check "refusal shows the allowlist" "the current value"  "$err" "2-9,11"
check "refusal names the status"   "HTTP 403"            "$err" "HTTP 403"
[ "$code" = 78 ] && echo "  ok refusal exits 78" || { echo "  FAIL refusal exit $code (must be non-zero)"; fails=$((fails+1)); }

# 3. an uninstalled owner is told where to install the App
stub_curl '{"error":"OWNER_NOT_INSTALLED","detail":"not installed on '"'"'testowner'"'"'.","remedy":"Install it on that account with Projects: read — https://github.com/apps/acp/installations/new","owners_available":["testorg"]}' 404
err="$(gp_acp_context 2>&1 >/dev/null)"
check "install URL is surfaced"   "the install URL"      "$err" "github.com/apps/acp/installations/new"
check "available owners listed"   "testorg"       "$err" "testorg"

# 4. a non-JSON body (a proxy error page) is still shown rather than dropped
stub_curl '<html>502 Bad Gateway</html>' 502
err="$(gp_acp_context 2>&1 >/dev/null)"
check "non-JSON body is shown"    "the raw body"         "$err" "502 Bad Gateway"

# 5. no board selected: the gateway is asked what exists
stub_curl '{"installations":[{"login":"testorg"},{"login":"testowner"}]}' 200
err="$(OWNER="" PROJECT="" GH_PROJECT_OWNER="" GH_PROJECT_NUMBER="" GH_PROJECT_CONFIG=/nonexistent bash -c '. scripts/lib.sh; gp_resolve; gp_require_target' 2>&1)"
check "missing target lists owners" "the owner hint"     "$err" "--owner testowner"

[ "$fails" = 0 ] && echo "acp context tests passed" || { echo "$fails failing"; exit 1; }
