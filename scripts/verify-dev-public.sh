#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:?Public application URL is required}"
BASE_URL="${BASE_URL%/}"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
for attempt in $(seq 1 12); do
  home=$(curl -sS --max-time 15 -o "$temp_dir/home" -w '%{http_code}' "$BASE_URL/" || true)
  ready=$(curl -sS --max-time 15 -o "$temp_dir/ready" -w '%{http_code}' "$BASE_URL/api/ready" || true)
  if [[ "$home" == "200" && "$ready" == "200" ]] && python3 - "$temp_dir/ready" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as source:
        result = json.load(source)
    sys.exit(0 if result.get('status') == 'ok' and result.get('db') == 'connected' else 1)
except (OSError, ValueError):
    sys.exit(1)
PY
  then
    break
  fi
  echo "Public application not ready (homepage $home, readiness $ready), attempt $attempt/12."
  if [[ "$attempt" == "12" ]]; then exit 1; fi
  sleep 10
done

# Invalid authentication must return a response, not leave an unhandled promise
# that terminates the process. Check health again after the rejection.
unauthenticated=$(curl -sS --max-time 15 -o "$temp_dir/auth" -w '%{http_code}' "$BASE_URL/api/bootstrap" || true)
[[ "$unauthenticated" == "401" ]] || { echo "Expected unauthenticated profile HTTP 401, got $unauthenticated."; exit 1; }
after_auth=$(curl -sS --max-time 15 -o "$temp_dir/ready" -w '%{http_code}' "$BASE_URL/api/ready" || true)
[[ "$after_auth" == "200" ]] || { echo "Backend failed after rejecting authentication: HTTP $after_auth."; exit 1; }
echo "Public homepage, database readiness, and authentication rejection passed."

# API errors must not become SPA HTML or HTTP 200 at CloudFront.
python3 - "$temp_dir/auth" <<'CHECKJSON'
import json,sys
with open(sys.argv[1]) as source: result=json.load(source)
assert result.get('code') == 'SIGN_IN_REQUIRED'
CHECKJSON
missing=$(curl -sS --max-time 15 -o "$temp_dir/missing" -w '%{http_code}' "$BASE_URL/api/not-a-route" || true)
[[ "$missing" == "404" ]] || { echo "Expected API 404, got $missing."; exit 1; }
route=$(curl -sS --max-time 15 -o "$temp_dir/route" -w '%{http_code}' "$BASE_URL/platform/companies" || true)
[[ "$route" == "200" ]] || { echo "Frontend deep-link failed: $route."; exit 1; }
