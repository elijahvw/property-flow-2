# Cash activity

Owners and managers with current finance authority use **Cash activity** for money already received or paid. The workspace is a cash history, not payment collection, accrual accounting or bank reconciliation. Staff and residents have no management-ledger access.

## Choose the source

Start with the financial workflow shown above the history:

- **Lease rent & balances** records a receipt against its lease and allocations. Its linked cash entry appears automatically; never enter it again manually.
- **Security deposits** records refundable funds, applications and refunds against the lease deposit account. Held funds remain separate from income.
- **Other income & paid expenses** records an actual movement without a linked lease receipt. Paid operating-expense imports retain their own reviewed source identity.

The links retain the selected property and respect the current feature projection. A read-only workspace allows permitted history/recovery review while blocking recording and correction. See [rent](rent-workflow.md), [deposits](security-deposits.md), [maintenance expenses](maintenance-costs.md) and [the import implementation contract](roadmap-continuation-2026-10-24.md) for their source rules.

## History, filters and correction

Property/date filters, removable active filters and Clear filters share the URL. Browser Back restores that view; resets retain unrelated source-return context. A nested property workspace retains its property. Exact summary totals cover all matching active records, independently of the bounded page. Omitted optional summary fields are unavailable, not fabricated zero values.

Records identify the property, movement type, amount, category and source/correction state. Follow lease, deposit, import or maintenance links to the original job. Correct source-owned receipts through their source workflow. A manual void requires the reviewed original version and a reason; it retains the original record/history and removes its amount from active totals. It does not refund or transfer money.

## Interrupted submissions and privacy

Unsubmitted drafts remain in memory under the shared editor contract. Manual cash creation additionally journals the **submitted** exact body/key in this tab's session storage before sending. It is scoped to the actor and company; this is financial request recovery, not general draft persistence. A storage failure blocks sending rather than risking a duplicate without a durable retry key.

After reload, the retained request is concealed until a fresh authorized read of its original property succeeds. Recovery freezes the original property, date, amount, category, memo and submission key. A different property offers a link back to the original property; it cannot rebase that request. A different actor/company cannot review or reuse it. Current read denials conceal private recovery; read-only policy permits review but blocks retry. Successful acknowledgment clears only that submitted journal. Malformed recovery blocks another manual creation until the retained request is safely reconciled; do not erase it and guess whether to resubmit.

The server remains authoritative: current company/property/role checks, immutable source identity and atomic financial/audit writes protect both first submission and replay. An uncertain result must reuse its original request. A new draft or retry key is never a correction for an unknown outcome.

## Validation and release

Use the client recovery parser tests, `tests/ui/finances.spec.ts` and `node scripts/test-finances.mjs` on its fresh disposable database. Cover response loss followed by reload, exact replay with one entry/audit, source links/filter history, read-only/revoked authority, wrong actor/company/property, void/retry and complete totals. The [overhaul validation record](platform-overhaul-2026-10-25.md) records the integrated source/results; hosted real-account acceptance remains separate.
