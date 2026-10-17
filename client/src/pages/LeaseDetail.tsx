import { LeaseProration, LeaseTransition } from "../components/LeaseLifecycle";
import { LeaseTermChanges } from "../components/LeaseTermChanges";
import { LeaseSettlement } from "../components/LeaseSettlement";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { api } from "../api";
import { formatDate } from "../dates";
import { LeaseTerms, LeaseRenewal, type Lease } from "./Leasing";
import { LeaseHousehold } from "../components/LeaseHousehold";
import { LeaseInvitations } from "../components/LeaseInvitations";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { leaseContext, leaseDirectoryPath } from "../lease-links";
import { TenantReturnLink } from "../components/TenantReturnLink";
import { statementPath } from "../statement";

export function LeaseDetail() {
  const { leaseId = "" } = useParams(),
    { data } = useAuth();
  return (
    <LeaseWorkspace
      key={`${leaseId}:${data?.user.id}:${data?.membership?.companyId}:${data?.permissions.join(",")}`}
      id={leaseId}
    />
  );
}
function LeaseWorkspace({ id }: { id: string }) {
  const { can } = useAuth();
  const r = useResource<Lease>(
      `/api/company/leases/${encodeURIComponent(id)}`,
      true,
      true,
    ),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams(),
    [editing, setEditing] = useState(false),
    [renewing, setRenewing] = useState(false);
  const [draftLease, setDraftLease] = useState<Lease | null>(null),
    [renewalDraft, setRenewalDraft] = useState<Lease | null>(null),
    [visited, setVisited] = useState<string[]>([]);
  const section = [
    "overview",
    "household",
    "invitations",
    "renewal",
    "settlement",
    "terms",
    "proration",
  ].includes(params.get("section") || "")
    ? params.get("section")!
    : params.has("onboarding")
      ? "household"
      : "overview";
  useEffect(() => {
    setVisited((previous) =>
      previous.includes(section) ? previous : [...previous, section],
    );
  }, [section]);
  useEffect(() => {
    const listener = (e: Event) => {
      if ((e as CustomEvent).detail === id) r.reload();
    };
    window.addEventListener("lease-lifecycle-changed", listener);
    return () =>
      window.removeEventListener("lease-lifecycle-changed", listener);
  }, [id]);
  if (!r.data)
    return (
      <section className="panel">
        <Link to="/company/leases">← All leases</Link>
        {r.error ? (
          <>
            <h1>Lease unavailable</h1>
            <p role="alert">{r.error}</p>
            <button onClick={r.reload}>Try again</button>
          </>
        ) : (
          <p role="status">Loading lease workspace…</p>
        )}
      </section>
    );
  const lease = r.data;
  const context = leaseContext(params),
    directory = leaseDirectoryPath(params);
  const editTerms = () => {
    setDraftLease((previous) => previous || lease);
    setEditing(true);
  };
  const tab = (value: string) => setParams({ ...context, section: value });
  const source = (module: string) =>
    `/company/${module}?${new URLSearchParams({ ...context, leaseId: id, leaseReturn: id })}`;
  return (
    <div className="lease-workspace">
      <TenantReturnLink />
      <nav className="record-breadcrumb" aria-label="Breadcrumb">
        <Link to={directory}>← All leases</Link>
        <span>/</span>
        <Link
          to={`/company/properties/${encodeURIComponent(lease.propertyId)}`}
        >
          {lease.property.name}
        </Link>
        <span>/</span>
        <span>{lease.unit.label}</span>
      </nav>
      <header className="page-heading">
        <p className="record-kicker">Lease workspace</p>
        <h1>
          {lease.property.name} · {lease.unit.label}
        </h1>
        <p>
          {lease.resident.name || lease.resident.email} · {lease.status} ·{" "}
          {formatDate(lease.startsOn)} through{" "}
          {formatDate(lease.endsOn, "Open ended")}
        </p>
      </header>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error} <button onClick={r.reload}>Refresh lease</button>
        </p>
      )}
      <nav className="lease-section-nav" aria-label="Lease sections">
        {[
          ["overview", "Overview"],
          ["terms", "Terms & changes"],
          ...(can("finance.manage") ? [["proration", "Partial rent"]] : []),
          ["household", "Leaseholders & occupants"],
          ["invitations", "Invitations & approvals"],
          ["renewal", "Renewal"],
          ...(can("finance.manage")
            ? [["settlement", "Move-out & settlement"]]
            : []),
        ].map(([value, label]) => (
          <button
            key={value}
            className={section === value ? "" : "secondary"}
            aria-current={section === value ? "page" : undefined}
            onClick={() => tab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === "overview" && (
        <div className="lease-overview">
          {lease.status === "draft" && (
            <section className="notice lease-setup-notice">
              <div>
                <h2>This lease is a draft</h2>
                <p>
                  Review the dates, terms and household, then activate the
                  record when it is ready. Portal invitations and recurring
                  billing are optional, separate actions.
                </p>
              </div>
              <button
                className="secondary"
                disabled={!!r.error}
                onClick={editTerms}
              >
                Review draft & activate
              </button>
            </section>
          )}
          {!!lease.overview?.pendingApprovals && can("members.manage") && (
            <section className="notice lease-setup-notice">
              <p>
                {lease.overview.pendingApprovals} resident{" "}
                {lease.overview.pendingApprovals === 1
                  ? "request needs"
                  : "requests need"}{" "}
                your approval.
              </p>
              <button
                className="text-button"
                onClick={() => tab("invitations")}
              >
                Review resident requests
              </button>
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="record-kicker">Agreement at a glance</p>
                <h2>Lease details</h2>
              </div>
              <button
                className="secondary"
                disabled={!!r.error}
                onClick={editTerms}
              >
                Edit lease record
              </button>
            </div>
            <dl className="lease-overview-facts">
              <div>
                <dt>Primary contact</dt>
                <dd>{lease.resident.name || lease.resident.email}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className="tenant-status neutral">
                    {lease.status === "active"
                      ? "Active"
                      : lease.status === "draft"
                        ? "Draft"
                        : "Ended"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Lease starts</dt>
                <dd>{formatDate(lease.startsOn)}</dd>
              </div>
              <div>
                <dt>Lease ends</dt>
                <dd>{formatDate(lease.endsOn, "Open ended")}</dd>
              </div>
              <div>
                <dt>Monthly rent</dt>
                <dd>{dollars(lease.rentCents)}</dd>
              </div>
              <div>
                <dt>Payment timing</dt>
                <dd>
                  Day {lease.rentDueDay ?? 1} · {lease.graceDays ?? 0} days
                  grace
                </dd>
              </div>
            </dl>
            {lease.paymentInstructions && (
              <div className="lease-payment-note">
                <h3>Payment instructions</h3>
                <p>{lease.paymentInstructions}</p>
              </div>
            )}
            <div className="actions">
              <button className="text-button" onClick={() => tab("terms")}>
                View terms & changes →
              </button>
              {can("finance.manage") && (
                <Link
                  to={statementPath(id, false, {
                    ...context,
                    statementFrom: "lease",
                  })}
                >
                  View statement →
                </Link>
              )}
            </div>
          </section>
          <div className="lease-overview-cards">
            <section className="panel">
              <h2>Household</h2>
              <p className="lease-overview-value">
                {lease.overview
                  ? `${lease.overview.householdCount} current ${lease.overview.householdCount === 1 ? "resident" : "residents"}`
                  : lease.resident.name || lease.resident.email}
              </p>
              <p className="help">
                Leaseholders and occupants share this unit. Portal invitations
                are optional.
              </p>
              <button className="text-button" onClick={() => tab("household")}>
                Review household
              </button>
            </section>
            {can("finance.manage") && (
              <>
                <section className="panel">
                  <h2>Rent & billing</h2>
                  <p className="lease-overview-value">
                    {lease.overview?.scheduleStatus === "active"
                      ? "Recurring billing active"
                      : lease.overview?.scheduleStatus === "paused"
                        ? "Recurring billing paused"
                        : "Manual billing"}
                  </p>
                  <p className="help">
                    Review charges, received payments and the shared lease
                    balance.
                  </p>
                  <Link to={source("rent")}>Open rent & billing</Link>
                </section>
                <section className="panel">
                  <h2>Security deposit</h2>
                  <p className="lease-overview-value">
                    {lease.overview?.depositRecorded
                      ? "Deposit record available"
                      : "No deposit recorded"}
                  </p>
                  <p className="help">
                    Deposits are tracked separately from rent. A deposit record
                    does not confirm money received.
                  </p>
                  <Link to={source("deposits")}>Open deposit</Link>
                </section>
              </>
            )}
          </div>
        </div>
      )}
      {(section === "household" || visited.includes("household")) && (
        <section className="panel" hidden={section !== "household"}>
          <LeaseHousehold leaseId={id} onChange={r.reload} />
          <button className="secondary" onClick={() => tab("invitations")}>
            Continue to invitations →
          </button>
        </section>
      )}
      {(section === "invitations" || visited.includes("invitations")) && (
        <section className="panel" hidden={section !== "invitations"}>
          <LeaseInvitations leaseId={id} startsOn={lease.startsOn} />
          <button className="secondary" onClick={() => tab("overview")}>
            Return to overview
          </button>
        </section>
      )}
      {can("finance.manage") &&
        (section === "proration" || visited.includes("proration")) && (
          <div hidden={section !== "proration"}>
            <LeaseProration lease={lease} changed={r.reload} />
          </div>
        )}
      {can("finance.manage") &&
        (section === "renewal" || visited.includes("renewal")) && (
          <div hidden={section !== "renewal"}>
            <LeaseTransition leaseId={id} changed={r.reload} />
          </div>
        )}
      {section === "renewal" && (
        <section className="panel">
          <h2>
            {lease.renewals?.length ? "Renewal draft" : "Prepare the next term"}
          </h2>
          <p className="help">
            {lease.renewals?.length
              ? "Review the renewal's household and terms before completing the renewal above."
              : "Record the current end date above, then prepare a renewal draft. You can review its household and terms before activating it."}
          </p>
          {lease.previousLeaseId && (
            <p>
              Previous term:{" "}
              <Link
                to={`/company/leases/${encodeURIComponent(lease.previousLeaseId)}`}
              >
                Open previous lease
              </Link>
            </p>
          )}
          {lease.renewals?.length ? (
            <p>
              <Link
                className="button"
                to={`/company/leases/${encodeURIComponent(lease.renewals[0].id)}`}
              >
                Continue renewal draft
              </Link>
            </p>
          ) : lease.status === "draft" ? (
            <p>Finish this draft before preparing a following term.</p>
          ) : !lease.endsOn ? (
            <p>Use the ending review above to record an end date first.</p>
          ) : (
            <button
              onClick={() => {
                setRenewalDraft((previous) => previous || lease);
                setRenewing(true);
              }}
              disabled={!!r.error}
            >
              Prepare linked renewal
            </button>
          )}
        </section>
      )}
      {(section === "terms" || visited.includes("terms")) && (
        <div hidden={section !== "terms"}>
          <LeaseTermChanges leaseId={id} changed={r.reload} />
          <button className="text-button" onClick={editTerms}>
            Review lease dates & recorded setup
          </button>
        </div>
      )}
      {can("finance.manage") &&
        (section === "settlement" || visited.includes("settlement")) && (
          <div hidden={section !== "settlement"}>
            <LeaseSettlement leaseId={id} />
          </div>
        )}
      <EditorDialog
        open={editing}
        title="Review lease terms"
        onClose={() => setEditing(false)}
      >
        {draftLease && (
          <Form
            key={`${draftLease.id}:${draftLease.version}`}
            label="Save lease terms"
            operation="lease.update"
            secondaryActions={
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraftLease(null);
                  setEditing(false);
                  r.reload();
                }}
              >
                Discard lease changes
              </button>
            }
            submit={async (f) => {
              await api(`/api/company/leases/${encodeURIComponent(id)}`, {
                method: "PATCH",
                body: {
                  ...Object.fromEntries(f),
                  endsOn: f.get("endsOn") || null,
                  rentDueDay: Number(f.get("rentDueDay")),
                  graceDays: Number(f.get("graceDays")),
                  paymentInstructions: f.get("paymentInstructions") || null,
                  expectedVersion: draftLease.version,
                },
              });
              setEditing(false);
              setDraftLease(null);
              r.reload();
            }}
          >
            <LeaseTerms prefix="Lease" value={draftLease} />
          </Form>
        )}
      </EditorDialog>
      <EditorDialog
        open={renewing}
        title="Prepare linked renewal"
        onClose={() => setRenewing(false)}
      >
        {renewalDraft?.endsOn && (
          <LeaseRenewal
            previous={renewalDraft}
            saved={(row) => {
              setRenewing(false);
              setRenewalDraft(null);
              navigate(
                `/company/leases/${encodeURIComponent(row.id)}?onboarding=household`,
              );
            }}
          />
        )}
      </EditorDialog>
    </div>
  );
}
