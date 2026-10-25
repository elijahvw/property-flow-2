# Dependency consolidation — October 24, 2026

The unique dependency and development-host work from PR #60 is now adapted in the consolidation working tree. The original October 21 report below remains historical evidence from `f5f1a2394e7eeae33ce063bfdadadb8171f9c35d`; its installation, build and preview observations are not presented as new combined-head runs.

## Current consolidation checks

- Root/client/server manifests and the workspace/standalone backend locks align on supported Node `^22.12.0 || >=24.0.0`, Prisma/client/adapter 7.10.1, Router 7.18.4, Vite 8.3.4, React plugin 5.2.0 and tsx 4.23.15. The old nodemon/ts-node/braces/chokidar-before-5 chain is absent; c12 still legitimately uses chokidar 5.
- A fresh October 24 lock-only audit initially found one moderate affected package, `fast-uri`, in all four audit scopes. Supported patch releases 3.1.9 and 4.2.3 replace 3.1.8 and 4.2.2 within the existing parent ranges. Those two nodes are the only lock changes beyond PR #60's dependency snapshot. No force install, arbitrary override or suppression is used.
- All four final lock-only audits exit zero with zero known advisories: workspace production/all and standalone backend production/all. Logs are `/tmp/propertyflow-consolidated-audit-{root-production,root-all,server-production,server-all}-final.json`. The initial moderate reports remain separate without `-final`.
- The extracted request-error handler preserves safe framework 4xx status, actionable access errors, retry headers and bounded server-failure telemetry without exposing parser/database text. Its three direct Fastify runtime checks pass in `/tmp/propertyflow-consolidated-request-errors-direct.log`.
- Installed `node_modules` and existing previews were not changed during this port. Clean installation, final combined builds/browser checks, the Vite 8 hostname smoke and the canonical local-preview upgrade SQL smoke remain for the coordinated validation checkpoint. These must pass before treating this working-tree port as the final release result.

The canonical preview helper applies only the consolidated 031–053 chain to its owned disposable restore clone, rejects foreign PR #60/partial/out-of-order schemas, and leaves the original backup untouched. It is not a hosted migration or data-reconciliation tool. No original private preview was started or migrated for this port.

---

# Dependency and development-server audit — October 21, 2026

The audit started from merged source `75d5342`. Package changes are local source changes; they are not a deployment or proof that all reachable security defects are absent. The audit covers both the workspace lock used by CI and `server/package-lock.json`, which the backend Docker build installs independently.

## Findings and remediation

The initial workspace `npm audit --omit=dev` reported **22 affected packages: 13 high, nine moderate, zero critical**. These are affected dependency entries, not 22 proven remotely exploitable application defects. Much of the tree came from the production-installed Prisma CLI's configuration, local development and Studio dependencies. Application requests use Fastify and the PostgreSQL driver adapter; the repository does not expose a Hono application or MySQL driver route simply because those libraries appeared in Prisma's dependency tree.

Conservative same-major updates removed the high production findings and patched the available router v6 issues. Two moderate router findings and development-tool advisories remained. The broader production-hardening request was then used to make explicit supported major updates, with their build/browser validation kept separate from dependency scan results. No `npm --force`, arbitrary transitive overrides or audit suppression was used.

| Dependency | Before | Updated source/lock | Purpose |
| --- | --- | --- | --- |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.4.2 locked; manifests `^7.4.1` | All 7.10.1; manifests `^7.10.1` | Keep CLI, generated client and PostgreSQL adapter aligned while replacing vulnerable CLI dependencies. Remains on stable Prisma ORM 7. |
| `react-router-dom` / `react-router` | 6.30.3 | 7.18.4 | Patch published redirect and hydration advisories, including issues without a v6 fix. Retains the existing declarative `BrowserRouter` application. |
| Vite | 5.4.21 | 8.3.4 | Replace the vulnerable development-server/toolchain version. Explicitly declared at both root and client because root preview/test scripts import Vite directly. |
| `@vitejs/plugin-react` | 4.7.0 locked; manifest `^4.3.1` | 5.2.0 | This version explicitly supports Vite 8 and React 18. No compiler/plugin architecture change is required. |
| Server development runner | nodemon 3.1.11 + ts-node 10.9.2 | `tsx` 4.23.15; `tsx watch src/bootstrap.ts` | Current nodemon still carries the affected chokidar/braces chain. Replacing the development runner removes that dependency instead of accepting npm's suggested historical downgrade. |
| Supported Node engines | Server `>=22`; root/client unspecified | `^22.12.0 || >=24.0.0` in all three manifests | Match the supported Vite/Prisma toolchain floor. Current workspace Node 24.19.0 satisfies it; CI and Docker use the Node 22 line. |

Updated Prisma dependencies include config 7.10.1, dev 0.24.17, deepmerge-ts 8.0.2, effect 3.20.0, defu 6.1.7, lodash 4.18.1, mysql2 3.24.4 and valibot 1.4.2. These follow the updated parent's supported dependency ranges. The older Hono tree is absent from the final locks. Pinned AWS SDK and observability packages remain pinned.

Vite 8 changes its underlying bundler and default browser target. The production build and relevant browser fixtures must therefore be run against the new installed dependencies before recommending this increment for release. Existing package version ranges remain bounded to their selected majors, and committed lock integrity supplies repeatable installation.

## Development-server defaults

`client/vite.config.ts` previously bound every interface and disabled allowed-host checks. The client command also forced a wildcard bind. The new defaults:

- Bind `127.0.0.1`; retain client port 5010 and the existing API proxy on port 5011.
- Preserve Vite's default hostname checks by removing `allowedHosts: true`.
- Allow a deliberate alternate bind through `PROPERTY_FLOW_DEV_HOST`, or Vite's explicit CLI `--host` option.
- Use Vite's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` for an exact controlled remote-preview hostname when required. Do not use an unrestricted hostname allowance.
- Set `server.forwardConsole: false` so Vite 8 does not automatically forward browser console content into the development terminal.

The disposable browser/local-preview runners already set loopback hosts explicitly and keep their existing ports/data handling. Exposing a preview is a deliberate development choice; a development server is not the production static hosting path.

Example for an explicitly configured remote development preview:

```sh
PROPERTY_FLOW_DEV_HOST=0.0.0.0 \
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=your-controlled-preview.example \
npm run dev:client
```

Use the actual controlled preview hostname. The example does not configure DNS, a proxy, TLS or network access by itself.

## Final dependency scan evidence

All four final lock-based audits completed with exit code zero:

| Scope | Critical | High | Moderate | Low/info | Total |
| --- | --- | --- | --- | --- | --- |
| Workspace, production dependencies | 0 | 0 | 0 | 0 | 0 |
| Workspace, all dependencies | 0 | 0 | 0 | 0 | 0 |
| Standalone backend Docker lock, production dependencies | 0 | 0 | 0 | 0 | 0 |
| Standalone backend Docker lock, all dependencies | 0 | 0 | 0 | 0 | 0 |

Commands were `npm audit --json --package-lock-only`, with `--omit=dev` for production scope and `--workspaces=false` for the standalone backend directory. JSON snapshots remain local at `/tmp/propertyflow-audit-{root-production,root-all,server-production,server-all}-final.json`. The initial workspace report is `/tmp/propertyflow-audit-dependencies.json`.

Additional structural validation passed: root/client/server dependency and engine declarations match their lock records; standalone backend declarations also match; the three Prisma packages all resolve to 7.10.1; router 7.18.4, root Vite 8.3.4 and plugin-react 5.2.0 resolve as intended; the old nodemon/ts-node/chokidar/braces chain is absent from both locks. Explicit root Vite declaration prevents a stale Vite 5 peer copy from being retained for root scripts.

Package remediation was performed with lock-only installs while existing browser fixtures were active; it did not replace their `node_modules` underneath them. The parent audit subsequently completed clean installation and the production client build with Vite 8/router 7. Its consolidated validation notes record the complete browser and backend outcomes separately.

An isolated installed-dependency smoke check also passed on Node 24.19.0 (`/tmp/propertyflow-dependency-smoke.mjs`, output `/tmp/propertyflow-dependency-smoke.log`):

- Resolved Vite configuration binds loopback, keeps hostname checks and disables console forwarding. A separate ephemeral-port server served the application HTML with `Host: localhost` (200) and rejected `Host: untrusted-preview.invalid` (403). It was closed afterward and did not use the active fixture/preview port.
- `tsx watch` started an isolated ESM TypeScript program with top-level await, resolved a `.js` import to its `.ts` source, and restarted after that imported dependency changed. Both expected outputs appeared; the watcher and temporary fixture were removed afterward.
- Source review confirmed both CI/deploy `setup-node` selectors use Node 22 and both backend Docker stages use `node:22-slim`. Those release lines support the declared Node 22.12 minimum; this local smoke ran Node 24.19.0 and does not establish a newly built Docker image or a separate Node 22 execution result.

Prisma engine download/generation restrictions in the managed environment must be reported separately if they remain unresolved; no shared database or provider was contacted for this dependency work. Successful dependency scans, client builds and development-runner checks do not replace backend/database and real-role acceptance.

## Advisory context and references

- [React Router backslash redirect advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6): affected input is an attacker-supplied navigation destination; 7.18.0 is the documented patch floor. Retain internal-route construction and server return-target validation after the upgrade.
- [React Router hydration advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg): the advisory excludes declarative mode. This app uses `BrowserRouter` and `createRoot`, not SSR hydration; upgrading still removes the affected dependency version.
- [Router v6 redirect/XSS patch](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2): the v6 patch is 6.30.6, but other published advisories required the v7 update.
- [Deepmerge recursive-graph advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): the failure requires recursive object graphs, which plain JSON does not supply. Its presence under trusted CLI configuration did not establish an HTTP exploit; the updated tree removes the affected version.
- [Vite server options](https://vite.dev/config/server-options): documents wildcard binding, hostname defaults, DNS-rebinding implications, explicit allowed-host environment configuration and development console forwarding.
- [Vite 8 migration](https://vite.dev/guide/migration): documents bundler/transform/default-target changes that require the new build/browser evidence.
- [Prisma ORM 7 requirements](https://www.prisma.io/docs/orm/v7/reference/system-requirements) and [release status](https://www.prisma.io/docs/orm/release-status): use the versioned ORM 7 requirements and supported stable major rather than adopting a release-candidate ORM rewrite.

Zero known npm advisories is a dated dependency result. Continue scanning the committed root and standalone backend locks in future increments, and continue the separate authorization, data-integrity, privacy, recovery and operational acceptance work.
