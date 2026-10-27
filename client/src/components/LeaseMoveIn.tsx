import { Link } from "react-router-dom";
import type { Lease } from "../pages/Leasing";
import { formatDate } from "../dates";
import { dollars } from "../money";
import "./LeaseMoveIn.css";

/** A projection of the saved lease, not a second workflow or completion record. */
export function LeaseMoveIn({ lease, owner, writable, finance, portal, unavailable, household, invitations, activate, rentPath, depositPath }: {
  lease: Lease;
  owner: boolean;
  writable: boolean;
  finance: boolean;
  portal: boolean;
  unavailable: boolean;
  household: () => void;
  invitations: () => void;
  activate: () => void;
  rentPath: string;
  depositPath: string;
}) {
  const draft = lease.status === "draft", ended = lease.status === "ended";
  const schedule = lease.overview?.scheduleStatus;
  return <section className="panel lease-move-in" aria-labelledby="lease-move-in-title">
    <div className="lease-move-in-heading">
      <div><p className="eyebrow">Your next steps</p><h2 id="lease-move-in-title">Move-in setup</h2></div>
      <span className="tenant-status neutral">{draft ? "Draft lease" : ended ? "Ended lease" : "Active lease record"}</span>
    </div>
    <p>{ended ? "This lease has ended. Its household and money records remain available for review." : draft ? "Your rental and tenant are recorded. Review the household and terms before activating the lease." : "The lease record is active. Review the household and choose any additional setup this rental needs."}</p>
    <ol className="lease-move-in-steps" aria-label="Move-in steps">
      <li><div><h3>Rental and primary tenant</h3><p>{lease.property.name} · {lease.unit.label} · {lease.resident.name || lease.resident.email}</p><p className="help">Recorded on this lease. A tenant record does not confirm portal access or first sign-in.</p></div><span className="lease-move-in-state">Recorded</span></li>
      <li><div><h3>Household</h3><p>Confirm everyone who belongs on the lease, their role and dates.</p><p className="help">{lease.overview ? `Current household: ${lease.overview.householdCount}. Future and former residents are shown in the household.` : "Open the household to review its current, future and former residents."} {owner ? "Owners manage the roster and approve leaseholder access." : "An owner manages roster changes and approvals."}</p><button type="button" className="text-button" onClick={household}>Review household</button></div></li>
      <li><div><h3>Lease terms and activation</h3><p>{formatDate(lease.startsOn)} through {formatDate(lease.endsOn, "Open ended")} · {dollars(lease.rentCents)} monthly</p><p className="help">{draft ? "Activation reserves the unit. It does not sign an agreement, post rent or start recurring billing." : ended ? "Retained history stays with this lease." : "The saved lease is active. Agreements, billing and portal access have their own recorded states."}</p></div><span className="lease-move-in-state">{draft ? "Awaiting activation" : ended ? "Ended" : "Active record"}</span></li>
    </ol>
    {draft && <div className="lease-move-in-next"><div><strong>Next: review the draft and activate when ready</strong><p className="help">Check the household above first. The save rechecks current terms, tenant eligibility and unit availability.</p></div>{writable ? <button type="button" disabled={unavailable} onClick={activate}>Review draft & activate</button> : <p className="help">Lease changes are read-only in this view.</p>}</div>}
    {!ended && (finance || portal) && <details className="lease-move-in-optional" open={!draft}>
      <summary>Additional setup · choose what this rental needs</summary>
      <p className="help">These are separate actions. No money is received and no portal access is granted by opening a task.</p>
      <ul className="lease-move-in-tasks">
        {finance && <>
          <li><div><strong>Rent and recurring billing</strong><p>{schedule === "active" ? "Recurring schedule active." : schedule === "paused" ? "Recurring schedule paused." : lease.overview && "scheduleStatus" in lease.overview ? "No current recurring schedule. Review manual charges or schedule history in rent setup." : "Review billing in rent setup."}</p></div><Link to={rentPath}>Review rent setup</Link></li>
          <li><div><strong>Security deposit</strong><p>{lease.overview && "depositRecorded" in lease.overview ? lease.overview.depositRecorded ? "Deposit record available. Review its requirement and receipts; a record does not confirm money received." : "No deposit record. Record a requirement if this rental needs one." : "Review the deposit requirement and any receipts in its source account."}</p></div><Link to={depositPath}>Review deposit setup</Link></li>
        </>}
        {portal && <li><div><strong>Tenant portal · optional</strong><p>Review tenant access and invitation status. An invitation is separate from verified acceptance and current access.</p></div><button type="button" className="text-button" onClick={invitations}>{owner ? "Review invitations & approvals" : "Review invitations"}</button></li>}
      </ul>
    </details>}
  </section>;
}
