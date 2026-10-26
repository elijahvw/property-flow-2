# Codex CLI portability handoff

This records a future workflow preference, not an EC2 migration or provisioning action. Finish the current task in its existing environment. No EC2 instance, host access, IAM credential, network rule, service, deployment or live data operation was created for this handoff.

## Code to transfer

The earlier validated source started on `work` at `47badacbd4c36c047f885ff109cbde6e223ea384` and was published through the platform → demo → PR63 recovery → AWS protection stack. PR65/66/63/67 are now merged in main `44747bd`. Current [PR64/68 reconciliation](pr64-pr68-reconciliation-2026-10-25.md) adds the Alloy/retirement integration locally; use its final reviewed head only after its own validation/publication, and record the actual remote commit before continuing. Main or the earlier AWS branch alone is not evidence of combined057/fixture6 acceptance. The [overhaul record](platform-overhaul-2026-10-25.md) and [original source evidence](acceptance-evidence/platform-overhaul-2026-10-25.json) retain their dated stages.

Keep platform → demo dependency ordering when preparing reviewable changes: the demo UI uses the shared Form deadline support. Keep provider ownership/cleanup guards with the demo change group. Prepared AWS retention/protection remains a separate source-only review group. Do not copy temporary database dumps, generated demo credentials, `.env` files, AWS credentials or private test traces into Git or a transfer bundle.

## Runtime and prerequisites

Use the repository manifests and `package-lock.json`, rather than choosing new dependency versions on the host.

| Component | Repository requirement / locked version |
| --- | --- |
| Node | `^22.12.0 || >=24.0.0`; this task used24.19.0 |
| React / Vite / TypeScript | 18.3.1 /8.3.4 /5.9.3 |
| Playwright | 1.58.2; install its matching Chromium and Linux dependencies when host setup is authorized |
| Prisma client/CLI | 7.10.1; normal generation needs the matching standard engine/cache |
| Fastify | 5.12.7 |
| Disposable database runners | Docker with PostgreSQL17 image; each runner verifies its own fresh tmpfs, loopback-bound database |
| Operations / failure summaries | Python3 standard library |

Inspect the intended checkout and `AGENTS.md` before running commands. Install locked dependencies with `npm ci` only when host setup is authorized. Verify the Docker daemon/browser prerequisites; do not assume an EC2 host already has them or grants the required access. Current local Prisma generation used matching official WASM tooling because `binaries.prisma.sh` was blocked; that environment limitation does not replace the normal build/release requirement on the new host.

## Fast and final checks

```sh
node scripts/local-validation.mjs plan --base=HEAD
node --test client/tests/*.test.cjs
node scripts/local-validation.mjs build client --reuse
node node_modules/@playwright/test/cli.js test -c playwright.production.config.ts tests/ui/leasing.spec.ts
```

The plan prints affected unit/UI/database checks. Review it against the actual change; it is guidance, not a substitute for the repository's acceptance or CI gates. Test-only/documentation-only changes do not require rebuilding application code when a verified eligible build remains unchanged. No test result is cached.

After implementation, focused checks and relevant disposable database workflows pass, hold source/build/container lifecycle fixed and run the complete production-client gate:

```sh
node scripts/local-validation.mjs build client --reuse
node node_modules/@playwright/test/cli.js test -c playwright.production.config.ts
```

An explicitly selected installed browser can be supplied with `PF_CHROMIUM_EXECUTABLE_PATH`; otherwise Playwright uses its installed browser. The production preview binds loopback5019, disables API proxying, retains failed traces privately and rejects build/test drift. Unsupported build environment overrides prevent cache reuse; a successful normal build can issue a one-use fresh receipt for the witnessed environment. Do not clear inherited trust settings just to obtain a cache hit.

Run relevant disposable browser/database runners sequentially, with no Docker startup/cleanup overlapping Chromium. Pure units and operations checks can run independently with isolated outputs. Keep API/session/RLS/source/audit assertions and the final aggregate gate; fix deterministic timing or actual product defects instead of adding retries/skips. [Commands, timings and receipt limits](agent-validation.md).

## Earlier verified local checkpoint

Final production-client browser 454/454 passes in 7.8m with two workers, zero retries and no source/build drift. Current-only layout 24/24 passes CLS ≤0.1 with no errors/overflow. Fresh disposable demo 19/19 includes the reported nine-account unfinished teardown 429 and exact resume; users 56/56 and finances 192/192 pass. Client 69, safe server 127 plus nine expected database skips, operations 94 and validation tooling 15 pass. The 550-file source/test/config digest is `4d6e0020534fb74a9f99f274d75081bb36f1c2d92c512c0e9e7138b3371991ce`; the evidence file records the build fingerprint and earlier diagnostic failures separately.

Normal client builds measured 22.630s and 23.358s. Focused 41-case navigation feedback took 1.2m; a corrected single case 3.6s. These differ in coverage and do not establish an apples-to-apples speedup. This managed environment uses fresh-only receipts, so there is no measured cache-hit saving. An eligible unchanged checkout may reuse its verified build; all required final tests still run.

## PR63 repaired source

The [reconciliation record](pr63-reconciliation-2026-10-25.md) supersedes the earlier checkpoint for the repaired source. Provider 25, safe server 130 plus nine expected database skips, client 69, fresh demo 22/22, leasing 66/66 and users 56/56 pass. The five new handoff fixtures pass, including phone-sized delayed return and denied recovery. The final 459/459 production suite passes in 8.4m, with zero retries and no source/build drift; its551-file source fingerprint is recorded there. Keep the four PR review order65 →66 →63 →67 and obtain actual remote HEAD before transfer. No EC2 host action is performed.

PR64/68 remain separate source:64 adds scheduled3a.m.Eastern development shutdown;68 retires scanning and has separate migration/fixture/docs/CI reconciliation. Neither is silently included in this tested checkout.

## Outstanding gates

Publication is authorized; published-head CI/comments/review, merge and deployment remain separate gates. Actual hosted schema/client/API/role/provider acceptance, normal Prisma generation, reviewed AWS plans/lifecycle preview, backup rollout/restore and runtime-secret/origin follow-ups remain in the overhaul/AWS records. The observed live demo error was HTTP429 during unfinished teardown; source and disposable fixes do not prove the live setup was cleaned up. No live cleanup or new identities were executed.

The Start/Stop contract and `config/dev-power.json` still govern infrastructure. Local builds/fixtures need no live AWS/Auth0 credentials. Do not assume an EC2 instance role grants authorization to operate the platform or infrastructure.
