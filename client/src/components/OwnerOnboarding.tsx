import { Link } from "react-router-dom";
import { useAuth, type Bootstrap } from "../context/AuthContext";

export function isOnboardingOwner(data: Bootstrap | null) {
  return (
    !!data &&
    data.user.status === "active" &&
    data.membership?.role === "owner" &&
    data.membership.status === "active" &&
    data.membership.company.status === "active" &&
    [
      "property.read",
      "property.write",
      "members.manage",
      "company.manage",
    ].every((permission) =>
      data.permissions.includes(permission as Bootstrap["permissions"][number]),
    )
  );
}
export default function OwnerOnboarding({
  properties,
  onAddProperty,
}: {
  properties: { data?: { id: string }[] };
  onAddProperty: () => void;
}) {
  const { data } = useAuth();
  if (!isOnboardingOwner(data) || !properties.data || properties.data.length)
    return null;
  return (
    <section
      className="panel empty-state"
      aria-labelledby="owner-onboarding-title"
    >
      <p className="record-kicker">Your first property</p>
      <h2 id="owner-onboarding-title">Start with the place you manage</h2>
      <p>
        Add the property, then its units and leases. You can record existing
        tenants without inviting them to a portal.
      </p>
      <div className="actions">
        <button onClick={onAddProperty}>Add your first property</button>
        <Link to="/company/settings">Review company settings</Link>
        <Link to="/company/residents">Manage tenants</Link>
      </div>
    </section>
  );
}
