#!/usr/bin/env bash
set -euo pipefail
: "${FRONTEND_BUCKET:?Set FRONTEND_BUCKET from the Terraform output}"
build_dir="${1:-client/dist}"
test -f "$build_dir/index.html"
test -d "$build_dir/assets"
# Publish new chunks before the entry document. Existing open tabs may still
# request a chunk from the previous release when they first visit that screen.
aws s3 sync "$build_dir/assets/" "s3://$FRONTEND_BUCKET/assets/" --exclude '*.map' --cache-control 'public,max-age=31536000,immutable'
# Source maps remain private, including maps left by earlier releases.
aws s3 rm "s3://$FRONTEND_BUCKET/assets/" --recursive --exclude '*' --include '*.map'
# Retain prior hashed chunks; delete obsolete non-asset public files as before.
aws s3 sync "$build_dir/" "s3://$FRONTEND_BUCKET" --delete --exclude 'assets/*' --exclude '*.map' --cache-control 'no-cache'
