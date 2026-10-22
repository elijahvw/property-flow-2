# Vacancy, prospects and manual applications

PF-21 connects management's availability review, prospect follow-up, manual application decisions and a real draft lease. This is local implementation, with validation tracked in the release notes. It does not publish listings, collect application fees, order screening, send messages, approve resident portal access or activate billing.

## Access and source boundaries

The existing `lease.manage` capability authorizes the workflow: current company owners and managers. Changing whether a unit is listed for rent additionally requires a fresh, active owner membership, including when replaying an earlier request. Managers may review readiness and view listing status. Staff, residents and platform-only administrators receive no admissions access by default. Every operation uses fresh server-side authorization, actor/company fences, explicit company filters and transaction-local PostgreSQL company context. All five new tables have forced row-level security; existing property/unit/contact/lease composite foreign keys prevent cross-company source links.

Prospect contact details and management notes are admissions records, separate from tenant contacts and identity accounts. Record only the name, email, optional phone, preferred move-in date, property/unit, follow-up and necessary management notes. There are no SSN, date-of-birth, income, bank, credit, screening or protected-characteristic fields. Unknown fields are rejected. Free text remains private management information and should never be used to collect those sensitive details. No applicant-facing portal is introduced by a prospect or application record.

## Availability

Vacancies lists existing active units with property/unit search, property/unit filters, independent readiness, lease coverage and listing filters, numbered pages and complete counts. It never creates a unit because a tenant or lease is missing. Archived units remain available through the existing unit history rather than being advertised for leasing.

- **Readiness not reviewed:** no readiness review is recorded. The shared version is zero only before either a readiness record or an owner listing decision exists. This never means ready to rent.
- **Ready, turnover in progress or unavailable:** deliberate management decisions with an optional readiness date and notes. The stored statuses remain `available`, `turnover` and `unavailable`. Saves require the current shared version and a durable submission key; history is retained.
- **Occupied:** a recorded active lease covers the company's current business date, including both term endpoints.
- **Upcoming lease:** no active lease covers today, but a recorded active lease starts later (stored coverage value `future`).
- **Vacant:** neither current nor future active lease coverage exists. Draft and ended lease records are excluded from coverage.
- **Listed for rent:** an owner explicitly chose **List for rent**. Every unit starts unlisted, including units with no lease and units already marked ready. **Remove from rental listings** reverses only this listing decision.

Readiness, lease coverage and the owner's listing decision remain separate. A vacant unit may still need turnover work; a unit marked Ready may still have a current lease. Owners can deliberately list a currently occupied unit or one with a future lease, with its source lease still shown. Readiness edits by either role preserve listing intent. Listing and readiness share one record version, so concurrent edits cannot overwrite a decision from a stale screen. Listing changes retain an immutable actor/action snapshot and atomic audit, and durable retries cannot create a second action.

The `listing` filter accepts `all`, `for_rent` and `not_listed`. Summary counts, including `forRent` and `notListed`, cover the matching property/unit/search set independently of the displayed page and readiness/occupancy/listing selections. Rows expose `forRent: false` and `listedAt: null` until an owner explicitly lists them. Rows link to their real lease sources. The feature does not infer physical occupancy, advertise a unit externally, reserve it for an applicant, create lease records or grant portal/billing access.

## Prospect and follow-up workflow

Create a company-owned prospect with the property, optional unit and contact information. Use a dated tour or task to record the next step. Follow-ups have open, completed and cancelled states, with versioned changes and retained history. The prospect can be closed and reopened through its record; closing does not erase its applications.

The prospect directory and dedicated follow-up endpoint are paginated. Prospect detail shows the first 25 follow-ups, applications and history entries with complete counts; the paged follow-up/history endpoints and application directory retain access to every matching source. It never rejects a large prospect simply because its history exceeds a single page.

Prospect identity/details used in submitted, reviewed or approved applications are protected. Withdraw those applications before changing the source person, then reopen and submit/review them again. Converted application sources remain retained; later personal-detail corrections belong in the linked tenant profile.

## Applications and decisions

An application selects a real open prospect and active unit in the same property. One open, unconverted application per prospect/unit is enforced by the database. The normal stages are draft → submitted → in review → approved or rejected. Management may withdraw an unconverted open application; reopening a rejected or approved application returns it to review, and reopening a withdrawn application returns it to draft. Unsupported transitions fail with an actionable conflict.

Every submitted/review/decision/withdraw/reopen action requires the reviewed version, a short explanation and a durable submission key. Concurrent decisions cannot overwrite one another. Notes are management-only. Immutable history records actor, date, action, version, explanation and the retained source snapshot; the UI receives readable history metadata rather than private snapshots or retry secrets. Editing application notes cannot rewrite a converted application.

## Reviewed conversion to a tenant and draft lease

Approval alone creates no account, contact, lease, assignment or money. Choose **Prepare draft lease**, review the selected person/unit, start/end dates, rent and payment terms, and either explicitly select a matching existing tenant profile or prepare its sign-in account.

The conversion uses the established `prepareAccount`/`saveAccount` identity contract. Provider work runs outside database transactions. Existing identities are resolved only by exact issuer/subject. Explicit existing-contact selection requires its reviewed version and matching prospect/account email. The narrow candidate endpoint returns active matching profiles with no management notes or emergency contacts. An unlinked profile already using the email requires explicit selection; it is never silently merged or duplicated.

The final freshly authorized transaction rechecks application/prospect/contact versions, account eligibility and the active unit. It atomically creates or reuses the exact mapped account/contact, creates **one real draft lease** with its primary leaseholder, records the application's permanent contact/lease IDs and appends immutable history/audit. The lease contains the reviewed dates, exact-cent rent and payment terms. A committed response lost in transit can be retried using the same submission key and original details; it returns the same linked results. A different key after conversion or changed details under the same key is rejected.

No company membership, property assignment, portal approval, invitation, recurring schedule, charge, deposit or cash entry is created. Continue the existing lease/household approval and billing workflows explicitly. Converted applications retain their final decision/source links and cannot be repurposed for another lease.

If authorization or a source changes during provider preparation, the local transaction fails without partially recording the conversion. A provider may already have prepared an account before such a failure; retries safely rediscover that same identity. The app never deletes a provider identity to undo a local failure. Missing identity-provider setup returns an explicit error and the application stays approved/unconverted.

## API and rollout

Additive migration `202610220044_vacancy_applications` creates `UnitAvailability`, `LeasingProspect`, `ProspectFollowUp`, `RentalApplication` and append-only `AdmissionsEvent`, indexes, source constraints, forced RLS and conversion/history retention triggers. No new service, provider configuration or always-on resource is introduced.

Additive migration `202610220045_rental_listing_intent` adds `forRent` with a false default and nullable `listedAt` to the existing RLS-protected availability table. Existing available/turnover/unavailable records remain unlisted; there is no backfill to true. A database check requires a listing timestamp exactly when `forRent` is true.

Main endpoints are `/api/company/vacancies`, `/api/company/units/:unitId/availability`, `/api/company/prospects`, `/api/company/prospects/:id/follow-ups`, `/api/company/applications`, their detail/history/action endpoints, and `/api/company/applications/:id/convert`. Owner-only `POST /api/company/units/:unitId/rental-listing` accepts `{forRent: boolean, expectedVersion: number, submissionKey: UUID}`. Its expected version is the vacancy row's shared `version`, including zero before any availability record exists; its response is the saved availability record. Readiness requests do not accept listing fields. Lists expose complete filter totals independently of their 25-row pages. Draft creation, edits, decisions, follow-ups, readiness and listing changes use durable submissions; meaningful changes preserve version checks and atomic audit.

Disposable PostgreSQL coverage exercises occupancy/availability separation, missing-review defaults, totals across pages, same-key concurrency/mismatch, CSRF and role/company denials, unsupported sensitive fields, staged/concurrent decisions, follow-up versions/history, narrow conversion candidates, exact account reuse, conversion replay, no portal/billing grants, audit rollback, mid-provider company suspension, RLS and immutable conversion sources. Browser tests and final run counts are recorded with release validation, separately from hosted rollout and real-account acceptance.

Local validation on October22, 2026: the final disposable leasing run passed **51/51** checks, including **12 vacancy/application/exact-unit cases**. Those cases cover the new additive migration, the real restricted PostgreSQL role, real API authorization/source records, concurrency and conversion behavior. The accompanying existing leasing/staff/renewal browser checks also passed. TypeScript validation passed against the generated models. Provider identity operations in these checks are fictional fixture implementations; this is not proof of live Auth0 setup, deployment or applicant acceptance. Evidence remains local in `/tmp/propertyflow-next-batch-leasing-final.log`.

The subsequent listing correction passed the focused disposable leasing suite **55/55**, with zero skips in 22.90 seconds. Four additional real API cases cover false defaults after a readiness review, explicit owner-only listing, shared-version listing/readiness races, durable concurrent retries, occupied/future lease preservation, complete listing filters across pages, fresh owner revocation on replay, company/CSRF/input denials, immutable events, audit rollback and the listing timestamp constraint. The actual generated-model TypeScript emit also passed. Evidence: `/tmp/propertyflow-manual-listing-leasing.log`. This is local validation; hosted rollout and user acceptance remain separate.

The existing fictional local preview was also upgraded without seeding or listing units. All 63 business-table fingerprints were preserved. Owner and manager API checks show both existing units unlisted; Preview Studio 2 keeps its prior readiness with `forRent=false` and `listedAt=null`. Evidence: `/tmp/propertyflow-preview-listing-preservation-verified.log` and `/tmp/propertyflow-preview-manual-listing-smoke.log`.
