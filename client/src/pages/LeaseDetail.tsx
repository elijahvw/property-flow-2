import { notificationContext } from "../notification-context";
import { documentLibraryBack, documentLibraryContext } from "../document-context";
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
import { PrivateDocuments } from "../components/PrivateDocuments";
import { LeaseInspections, InspectionSettlementContext } from "../components/LeaseInspections";
import { LeaseAgreements } from "../components/LeaseAgreements";
import { agreementContext } from "../agreement-context";
import { LeaseInvitations } from "../components/LeaseInvitations";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { dollars } from "../money";
import { leaseContext, leaseDirectoryPath, leasePath } from "../lease-links";
import { TenantReturnLink } from "../components/TenantReturnLink";
import { statementPath } from "../statement";
import { prospectContext, withProspectContext } from "../prospect-context";
import "./LeaseDetailNavigation.css";

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
  const { can, data: auth } = useAuth();
  const visible = (key: "finances" | "documents" | "inspections" | "agreements" | "resident_portal") => auth?.companyFeatures?.[key] !== "disabled";
  const hasFinance = can("finance.manage") && visible("finances");
  const hasDocuments = visible("documents"), hasInspections = visible("inspections"), hasAgreements = visible("agreements") && hasDocuments, hasPortal = visible("resident_portal");
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
  const requestedSection = [
    "overview",
    "documents",
    "inspections",
    "agreements",
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
  const available = (value: string) => value === "documents" ? hasDocuments : value === "inspections" ? hasInspections : value === "agreements" ? hasAgreements : value === "invitations" ? hasPortal : ["terms", "proration", "settlement"].includes(value) ? hasFinance : true;
  const section = available(requestedSection) ? requestedSection : "overview";
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
      <><TenantReturnLink /><section className="panel">
        <Link to={withProspectContext("/company/leases", params)}>← All leases</Link>
        {r.error ? (
          <>
            <h1>Lease unavailable</h1>
            <p role="alert">{r.error}</p>
            <button onClick={r.reload}>Try again</button>
          </>
        ) : (
          <p role="status">Loading lease workspace…</p>
        )}
      </section></>
    );
  const lease = r.data;
  const context = leaseContext(params),
    directory = withProspectContext(leaseDirectoryPath(params), params);
  const editTerms = (activate = false) => {
    setDraftLease((previous) => activate ? { ...(previous || lease), status: "active" } : previous || lease);
    setEditing(true);
  };
  const tab = (value: string) => setParams({ ...context, ...documentLibraryContext(params), ...agreementContext(params), ...notificationContext(params), ...(params.get("inspectionId")?{inspectionId:params.get("inspectionId")!}:{}), section: value });
  const sectionGroups = [
    { title: "Lease details", items: [
      ["overview", "Overview"],
      ...(hasFinance ? [["terms", "Terms & changes"], ["proration", "Partial rent"]] : []),
    ] },
    { title: "People & access", items: [
      ["household", "Leaseholders & occupants"],
      ...(hasPortal ? [["invitations", "Invitations & approvals"]] : []),
    ] },
    { title: "Documents & condition", items: [
      ...(hasDocuments ? [["documents", "Documents"]] : []),
      ...(hasAgreements ? [["agreements", "Agreements"]] : []),
      ...(hasInspections ? [["inspections", "Inspections"]] : []),
    ] },
    { title: "Renewal & move-out", items: [
      ["renewal", "Renewal"],
      ...(hasFinance ? [["settlement", "Move-out & settlement"]] : []),
    ] },
  ].filter(group => group.items.length);
  const currentGroup = sectionGroups.find(group => group.items.some(([value]) => value === section))!;
  const currentSection = currentGroup.items.find(([value]) => value === section)![1];
  const source = (module: string) =>
    `/company/${module}?${new URLSearchParams({ ...context, leaseId: id, leaseReturn: id })}`;
  return (
    <div className="lease-workspace">
      <TenantReturnLink />
      {section !== requestedSection && <p className="notice" role="status">The requested lease area is unavailable under this company's feature settings. The lease overview remains available.</p>}
      <nav className="record-breadcrumb" aria-label="Breadcrumb">
        {documentLibraryBack(params)&&<Link to={documentLibraryBack(params)!}>Back to document library →</Link>}
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
      <label className="lease-section-select">Lease section<select aria-label="Lease section" value={section} onChange={event=>tab(event.target.value)}>{sectionGroups.map(group => <optgroup key={group.title} label={group.title}>{group.items.map(([value,label])=><option key={value} value={value}>{label}</option>)}</optgroup>)}</select></label>
      <nav className="lease-task-navigation" aria-label="Lease sections">
        {sectionGroups.map(group => (
          <div className="lease-task-group" key={group.title} role="group" aria-label={group.title}>
            <p>{group.title}</p>
            {group.items.map(([value, label]) => (
              <button
                key={value}
                className="secondary"
                aria-current={section === value ? "page" : undefined}
                aria-controls="lease-section-content"
                onClick={() => tab(value)}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <p className="lease-section-location" role="status" aria-atomic="true">{currentGroup.title}<span aria-hidden="true"> / </span><strong>{currentSection}</strong></p>
      <div id="lease-section-content" role="region" aria-label={currentSection}>
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
              <div className="actions"><button className="text-button" onClick={()=>tab("household")}>Review household</button>{hasFinance&&<Link to={source("rent")}>Review rent setup</Link>}</div>
              <button
                className="secondary"
                disabled={!!r.error}
                onClick={() => editTerms(true)}
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
                onClick={() => editTerms()}
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
              {hasFinance && <button className="text-button" onClick={() => tab("terms")}>
                View terms & changes →
              </button>}
              {hasFinance && (
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
            {hasFinance && (
              <>
                <section className="panel">
                  <h2>Rent & payments</h2>
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
                  <Link to={source("rent")}>Open rent & payments</Link>
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
          {hasPortal && <button className="secondary" onClick={() => tab("invitations")}>
            Continue to invitations →
          </button>}
        </section>
      )}
      {hasPortal && (section === "invitations" || visited.includes("invitations")) && (
        <section className="panel" hidden={section !== "invitations"}>
          <LeaseInvitations leaseId={id} startsOn={lease.startsOn} />
          <button className="secondary" onClick={() => tab("overview")}>
            Return to overview
          </button>
        </section>
      )}
      {hasFinance &&
        (section === "proration" || visited.includes("proration")) && (
          <div hidden={section !== "proration"}>
            <LeaseProration lease={lease} changed={r.reload} />
          </div>
        )}
      {hasFinance &&
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
                to={leasePath(lease.previousLeaseId, prospectContext(params))}
              >
                Open previous lease
              </Link>
            </p>
          )}
          {lease.renewals?.length ? (
            <p>
              <Link
                className="button"
                to={leasePath(lease.renewals[0].id, prospectContext(params))}
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
      {hasFinance && (section === "terms" || visited.includes("terms")) && (
        <div hidden={section !== "terms"}>
          <LeaseTermChanges leaseId={id} changed={r.reload} />
          <button className="text-button" onClick={() => editTerms()}>
            Review lease dates & recorded setup
          </button>
        </div>
      )}
      {hasFinance &&
        (section === "settlement" || visited.includes("settlement")) && (
          <div hidden={section !== "settlement"}>
            {section==="settlement"&&params.get("inspectionId")&&<InspectionSettlementContext leaseId={id} inspectionId={params.get("inspectionId")!}/>}
            <LeaseSettlement leaseId={id} />
          </div>
        )}
      {hasDocuments && section === "documents" && <PrivateDocuments source="leases" sourceId={id} />}
      {hasInspections && (section === "inspections" || visited.includes("inspections")) && <div hidden={section !== "inspections"}><LeaseInspections leaseId={id}/></div>}
      {hasAgreements && (section === "agreements" || visited.includes("agreements")) && <div hidden={section !== "agreements"}><LeaseAgreements leaseId={id}/></div>}
      </div>
      <EditorDialog
        open={editing}
        title="Review lease terms"
        onClose={() => setEditing(false)} onDiscard={()=>{setDraftLease(null);setEditing(false);r.reload();}}
      >
        {draftLease && (
          <Form
            key={`${draftLease.id}:${draftLease.version}:${draftLease.status}`}
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
        onClose={() => setRenewing(false)} onDiscard={()=>{setRenewalDraft(null);setRenewing(false);r.reload();}}
      >
        {renewalDraft?.endsOn && (
          <LeaseRenewal
            previous={renewalDraft}
            saved={(row) => {
              setRenewing(false);
              setRenewalDraft(null);
              navigate(
                leasePath(row.id, { onboarding: "household", ...prospectContext(params) }),
              );
            }}
          />
        )}
      </EditorDialog>
    </div>
  );
}
