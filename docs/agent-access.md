# Identity, authorization and history

Read when changing authorization, identity, membership or financial behavior.

- Auth0 is the sign-in account authority. New tenants and every new leaseholder/occupant require an existing or precreated Auth0 account; legacy unbound history is retained. Use the existing User + exact Identity mapping, never parallel contact/invitation accounts. Account existence, contact email, a profile or a lease record grants no portal access by itself.
- Keep profile, platform authority, company membership, property access and lease participation distinct. Identity is keyed by issuer/subject, never automatically linked by email.
- Leaseholders may see authorized shared lease finances; occupants have no financial access. Owners approve resident additions/removals. Emergency contacts are separate from household members.
- Staff default to read-only property access. An explicit owner grant may add maintenance execution, limited to the current assignee and current property scope; it grants no other management/document/financial authority. Residents may edit permitted personal details, never their own company role, property/unit assignment, lease terms or access grants.
- Authorize each API operation from fresh server-side membership and permissions. Treat route IDs and `X-Company-ID` as untrusted input.
- Property data operations use transaction-local company context, explicit company filters and existing row-level security. Platform authority does not bypass company boundaries.
- Preserve financial source IDs, signed/posted history and immutable audit events. Record consequential changes atomically; use version checks and durable submission keys where retries or concurrent edits could duplicate or overwrite work.
- Browser calls use `client/src/api.ts` and server-managed cookies/CSRF. Never request OAuth tokens in page components or expose secrets in logs, responses or artifacts.
- Read `docs/access-overhaul.md` for access/deployment boundaries and `docs/open-observability.md` for current Grafana monitoring; historical Datadog instructions are superseded.
