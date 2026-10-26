# Current work — October 26, 2026

## Scope and baseline
Follow-up to merged PR71: actionable demo teardown/company-deletion recovery; platform-owner any-account impersonation; scoped company/platform-owner manual passwords; separate company role from platform Support. Branch `codex/demo-recovery-user-controls` starts at main `de72a22`, re-fetched unchanged before publication. Earlier dirty checkout `../prelogin-users-preserved-20261025` and older worktrees remain untouched. Jira disabled; Stripe last. No deployment, hosted password change, membership removal, Support revoke or demo teardown performed.

Read-only hosted inspection found a separately added existing owner and a generated resident with explicit platform Support grants. Those explain the foreign-member/generated-authority blockers; company ownership alone grants no support features. Existing versioned Users → Company access → No company access preserves the outsider's login/history; explicit Support revoke resolves the generated account's authority mismatch. Refresh/review the teardown plan afterward. Never bypass ownership checks or mutate hosted grants automatically.

## Implemented locally
Demo review names affected accounts, reasons and recovery links; exact source snapshots bind its hash. Company deletion links its own demo teardown. Pending password attempts block retirement; dispatch invalidates obsolete generated password sheets. Fixture7/source graph is unchanged: account controls use existing identities without automatic Support grants/password changes.

Platform-owner read-only views cover every recorded account while preserving actual target status/permissions and nullable pinned membership. Support-only actors retain narrower eligible company-user targeting; company owners alone remain denied. Fresh real-actor/session fences reject queued revoked/expired views.

Manual passwords require the exact existing configured Auth0 database identity. Company owners are limited to active nonplatform members of their current active company. Dedicated transient fields never enter drafts/logs/storage; durable HMAC receipts, atomic dispatch/audit/session revocation, CAS finalizers and explicit uncertain-attempt status/release protect recovery, including disabled/provider-unavailable historical targets for platform owners. Independent review findings were corrected and regression-tested.

## Integrated validation
Normal server/client builds and fingerprint verification pass. Safe server134 pass/9 intentional DB skips; client70; operations100; power guard pass. Fresh sequential runners:users73,impersonation18,demo26,billing15,leasing68,finances192,maintenance149,roadmap40,observability exit0 with all three signals/redaction. Docker cleanup completed. Impersonation row-fence negative proof fails as expected; compiled artifact restored and normally rebuilt.

Focused demo5/5 passes after subscription fixture repair. Complete browser first471/472; trace proved an existing stale-draft test edited before save acknowledgment. Added explicit UI readiness without weakening assertions. Final frozen full suite passes472/472 in2.0m, zero retries/no retained final failure traces and matching fingerprints (`/tmp/pf-user-controls-browser-final-verified.log`). A prior sandbox-only launch failed before tests on loopback EPERM. Application/test source stayed fixed during the run; phone screenshots inspected. [Release evidence](local-feature-release-notes.md) retains failures and corrections.

## Remaining
Published and attached [PR72](https://github.com/elijahvw/property-flow-2/pull/72); code commit `b659b1d` is pushed. Final documentation/diff review passed; the active checkout is clean after the publication handoff commit. PR remains open/unmerged; hosted checks were not awaited. Later deployment requires additive migrations059→060 and matching API/client; hosted CI/review and real Auth0/role acceptance remain separate. Do not merge/deploy or repair hosted grants without authorization.
