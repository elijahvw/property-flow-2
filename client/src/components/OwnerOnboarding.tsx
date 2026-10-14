import React from "react";
import { Link } from "react-router-dom";
import { useAuth, type Bootstrap } from "../context/AuthContext";
import { useResource } from "../useResource";

export function isOnboardingOwner(data: Bootstrap | null) {
  return !!data && data.user.status === "active" &&
    data.membership?.role === "owner" &&
    data.membership.status === "active" &&
    data.membership.company.status === "active" &&
    ["property.read", "property.write", "members.manage", "company.manage"].every(
      (permission) => data.permissions.includes(permission as Bootstrap["permissions"][number]),
    );
}

type Resource<T> = { data?: T; error?: string; reload: () => void };
type Invitation = { companyId: string; role: string };
type Props = {
  properties: Resource<{ id: string }[]>;
  onAddProperty: () => void;
};

export default function OwnerOnboarding(props: Props) {
  const { data } = useAuth();
  // Mount data loading only for an active, authorized company owner.
  return isOnboardingOwner(data) ? <OwnerChecklist {...props} company={data!.membership!.company} /> : null;
}

function Progress({ resource, complete, empty }: {
  resource: Resource<unknown>;
  complete: string | null;
  empty: string;
}) {
  if (resource.error) return (
    <div className="notice error" role="alert">
      <p>Progress could not be checked: {resource.error}</p>
      <button className="secondary" onClick={resource.reload}>Try again</button>
    </div>
  );
  if (!resource.data) return <p role="status">Checking progress…</p>;
  return <p><strong>{complete || empty}</strong></p>;
}

function OwnerChecklist({ properties, onAddProperty, company }: Props & {
  company: { id: string; name: string };
}) {
  const invitations = useResource<Invitation[]>("/api/invitations");
  const issued = invitations.data?.some((i) => i.companyId === company.id && i.role === "resident");
  return (
    <section className="panel" aria-labelledby="owner-onboarding-title">
      <h2 id="owner-onboarding-title">Get started with your company</h2>
      <p>Track your first steps. Property and invitation progress is checked from accessible records.</p>
      <ol className="onboarding-list">
        <li>
          <h3>Company access</h3>
          <p><strong>Confirmed</strong> · You are an active owner of {company.name}.</p>
          <Link to="/company/settings">Review company settings</Link>
        </li>
        <li>
          <h3>Create your first property</h3>
          <Progress resource={properties} complete={properties.data?.length ? "Property added" : null} empty="No properties yet" />
          {properties.data?.length ? <p>Your property directory is below.</p> :
            <button className="secondary" onClick={onAddProperty}>{properties.data ? "Add your first property" : "Add property"}</button>}
        </li>
        <li>
          <h3>Issue a resident invitation</h3>
          <Progress resource={invitations} complete={issued ? "Resident invitation issued" : null} empty="No resident invitation in the available records" />
          <p>This step records invitation creation only. Share the link directly from Team. Review its acceptance, expiry or revocation there.</p>
          <p className="help">Only the latest 100 invitations are available. Accepted residents receive company membership; assign accepted residents using Manage residents; maintenance setup is still unavailable.</p>
          <Link to="/company/members">{issued ? "Review invitations in Team" : "Invite a resident in Team"}</Link>
        </li>
      </ol>
      <button className="secondary" onClick={() => { properties.reload(); invitations.reload(); }}>Check progress again</button>
    </section>
  );
}
