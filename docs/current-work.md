# Current work — October 25, 2026

## Scope and preservation
User requested latest main, platform-owner company deletion, simpler sales demo with readable emails and clear unit occupancy. Active `prelogin-users/` is now based on fetched main `e8b87c7`, branch `codex/company-delete-simple-demo`. Earlier dirty checkout moved intact to `../prelogin-users-preserved-20261025`; its status and complete tracked diff compare byte-for-byte with the pre-move snapshots. All older checkouts preserved. User authorized branch push and PR creation. No merge, deployment, live provider action or actual company deletion occurred. Jira disabled; Stripe last.

## Implemented locally
Company deletion: additive migration058, fresh platform authority/CSRF/version/exact-name confirmation, durable retry receipt, atomic membership/invitation/session revocation plus audit. Deleted companies leave directory; direct tombstone and billing history are read-only, reactivation blocked. Retains financial, lease, document and audit sources. Automatic demos require completed provider teardown before company deletion. UI preserves uncertain DELETE payload/version/key through close/reopen. Includes bounded telemetry/activity labels and help/contract updates.

Sales demo fixture7: exactly two properties, three units each, four occupied, one ready/listed, one turnover. Reuses units for import, archive/restore, ended lease/settlement/refund and renewal; preserves all shipped company feature-catalog sources and the ten presentation stops. Casey/Avery share one lease. Normal name-based emails use short generation domains; legacy generations retain original addresses/history. Cleanup uses recorded addresses or pinned fixture format without decrypting credentials, so a lost key cannot strand Auth0 cleanup. Update existing demos through reviewed rebuild; no posted graph rewrites. See docs/sales-demo.md.

Units: Occupied/Not occupied is separate from Active/Archived inventory. Inclusive current active lease dates use company business day. Future/draft/ended leases do not count; staff receive no tenant/finance detail. Availability/help/contracts aligned. No occupancy migration.

## Validation
Normal client/server builds passed. Safe server130 pass/nine expected DB skips, client70, operations100 and power guard pass. Fresh users57, leasing68, billing15, impersonation15 and final demo24 pass; runners cleaned up sequentially. Saved-task test helper now runs in an awaited subtest to fix baseline fixture ordering pollution without changing assertions. Initial telemetry test needed loopback sandbox access; unchanged suite passed afterward. Independent review's cleanup-key finding fixed and re-reviewed. Phone deletion/occupancy screenshots inspected.

Complete fixed production browser suite passed463/463 in1.7m, zero retries, no retained failure traces or source/build drift; log `/tmp/pf-company-demo-browser-final.log`. Logs `/tmp/pf-company-demo-*`, company checks `/tmp/pf-company-deletion-*`. Retain earlier failed logs. No existing browser tabs modified.

## Next
Implementation is validated; publishing the reviewed branch as a PR against main. CI and review remain separate gates. Migration058 plus matching API/client are required on a later authorized deployment; live Auth0 and actual-role acceptance remain unverified.
