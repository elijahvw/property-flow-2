> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# PF-07 · Itemized move-out settlement

Implemented locally for user review on October 16, 2026. This batch is not deployed. The preview is at `http://127.0.0.1:5090`; open an exact lease and choose **Move-out & settlement**. See [PF-06 accounting](deposit-applications-refunds.md) for the underlying disposition and refund records.

## Workflow

Management reviews posted charges and credits in the existing rent ledger before preparing settlement. The four-step editor records the actual move-out date, forwarding details (provided or explicitly not supplied), proposed applications of held deposit to named unpaid charges, and confirmation to pause any reviewed active recurring schedules. Each proposed application requires a tenant-visible supporting reference. These are manual evidence references, not uploaded inspections, signed documents or automated legal determinations.

The server preview computes every amount from the current sources. Confirmation shows the move-out, forwarding information, named applications, unpaid charges, remaining deposit available to return, separate unapplied payment credit and schedules to pause. The source fingerprint and reviewed lease/settlement versions must still match at commitment. A changed receipt, charge, allocation, credit, disposition, deposit requirement, lease, company business date or billing cursor invalidates confirmation.

Finalization atomically records the reviewed PF-06 deposit applications, pauses the reviewed active schedules, saves an immutable settlement version and writes audits. Applications use the current company business date; the actual move-out date is a separate recorded fact. No refund cash entry is created. Existing financial IDs and allocations remain intact.

A saved review does not end the lease, change the household, waive debt or send money. Follow-up links lead to actual deposit refunds, payment refunds/collections and lease-end terms. Coordinated occupancy/end/renewal transitions remain PF-10. This PR adds management inspection/evidence/comparison links through [lease inspections](lease-inspections.md), without automatic financial application. Statutory deadlines, notices, interest and e-signatures remain outside scope; no jurisdiction defaults are invented.

## Versions, sources and corrections

One settlement head identifies the current state (`finalized` or `open`). Each finalization or reopening creates an immutable revision with its reason, actual move-out, source snapshot, actor, date and durable submission identity. A reopening preserves earlier versions, does not reverse applications and does not resume recurring billing. Subsequent money activity is allowed and explicitly flagged as newer than the saved review. A revision never silently becomes a live balance.

The saved view retains charge/payment/credit/application/correction sources, allocations, deposit receipts/movements and billing cursors. CSV downloads include the review version and source references/IDs. Human-readable settlement references replace unexplained `ST` codes. History is paged; oversized underlying financial sources fail closed rather than produce partial balances.

Reversal/correction of money remains in the original PF-06 workflow. Record a new reviewed settlement after any required correction. Finalization and reopening each replay the original committed result for the same user/company UUID and fingerprint, after checking current authority.

## Access and database boundaries

Owner/manager finance and lease authority is required for management actions. Staff, occupants and platform-only authority cannot edit settlement or retrieve company financial sources. Resident saved reviews use the existing active/verified company membership, property-assignment and approved shared-lease access rules. Residents cannot edit settlement.

Forwarding details are management-only and are stored separately from the public source snapshot. Resident responses omit forwarding, source fingerprints, actor IDs, internal receipt/payment notes and private payment references. Saved snapshots use an explicit public shape so a management response cannot accidentally become tenant-visible later.

Migration `202610160021_move_out_settlements` is additive and transactional: forced company RLS, compound lease/property/company foreign keys, immutable revision grants, lease write fences and deferred checks tying each head version to its matching revision. Audits, applications, pauses and snapshots share one serializable transaction. Original financial records are not migrated or recreated. After recording new money, an older application unaware of these sources is not a safe rollback target; use a forward fix or a reviewed full restore.

## Local validation

Both production builds pass. The disposable real PostgreSQL/API/browser suite passes 152 checks, covering concurrent replay, changed-source rejection, exact balances, schedule pause, immutable history, reopening, audit rollback, denied roles, resident privacy, and lost committed browser responses. The 155-check UI suite passes, including the existing workflows and new role-specific profile/layout checks. Safe server unit checks pass 49 (5 database suites intentionally skipped with DB URLs removed); client unit checks pass 18; operations checks pass 51. Desktop and 390-pixel mobile layouts were inspected.

Only disposable loopback databases were migrated. No cloud apply, CI run, release PR, merge, push or deployment was performed.
