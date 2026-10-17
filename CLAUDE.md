# Property Flow development

Read [AGENTS.md](AGENTS.md) for shared product, implementation and delivery guidance.

- Client: React + Vite. Backend: Fastify + Prisma/PostgreSQL. Identity: Auth0 OIDC; browser access uses server-managed cookies.
- Build client: `npm run build --workspace=@property-flow/client`.
- Build server: `DATABASE_URL=<isolated-build-url> npm run build --workspace=server`.
- Unit tests: `node --test server/tests/*.test.mjs` and `node --test client/tests/*.test.cjs` after server build.
- Integration tests require the disposable local `propertyflow_access_test` database and `TEST_DATABASE_URL`; never point them at development/customer data.
- Browser calls use `client/src/api.ts`; never request OAuth tokens in page components.
- API permissions live in `server/src/access.ts`. Resolve company context from current membership. `X-Company-ID` is untrusted input and cannot grant access.
- Property queries run in `tenantTransaction` with transaction-local company context and an explicit company filter. Platform authority does not bypass this boundary.
- Keep profile, platform role and company membership separate. Missing assignments grant no company permissions.
- Read `docs/access-overhaul.md` before changing sign-in, migrations or deployment configuration.
