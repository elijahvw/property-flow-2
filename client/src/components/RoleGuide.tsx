import { useResource } from "../useResource";
import type { Capability } from "../navigation";
const capabilities: [Capability, string][] = [
  ["company.manage", "Company details and preferences"],
  ["members.manage", "Team access, households and resident approvals"],
  ["property.write", "Properties and units"],
  ["resident.assignment.manage", "Tenant profiles and property assignments"],
  ["lease.manage", "Lease terms and renewals"],
  ["finance.manage", "Rent, deposits, settlements and financial reports"],
  ["maintenance.manage", "Maintenance requests and status updates"],
];
export function RoleGuide() {
  const r = useResource<{
    roles: { role: string; label: string; permissions: Capability[] }[];
  }>("/api/company/roles", false, true);
  return (
    <div className="role-guide">
      <p className="account-hint">
        Company roles apply to this workspace. A platform owner administers
        companies and users; platform access alone does not grant access to
        company operations.
      </p>
      {r.error ? (
        <p className="notice error" role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Refresh role permissions
          </button>
        </p>
      ) : !r.data ? (
        <p role="status">Loading current role permissions…</p>
      ) : (
        <div className="role-guide-cards">
          {r.data.roles.map((role) => (
            <article key={role.role}>
              <h3>{role.label}</h3>
              <p className="section-caption">
                {role.role === "owner"
                  ? "Company administration & operations"
                  : role.role === "manager"
                    ? "Day-to-day property operations"
                    : role.role === "staff"
                      ? "Property visibility"
                      : "Personal and approved rental access"}
              </p>
              <ul>
                {capabilities
                  .filter(([key]) => role.permissions.includes(key))
                  .map(([key, label]) => (
                    <li key={key}>
                      {label}
                      {key === "lease.manage" &&
                        !role.permissions.includes("members.manage") && (
                          <span>
                            View the household; owners manage resident records
                            and portal invitations.
                          </span>
                        )}
                    </li>
                  ))}
                {role.permissions.includes("property.read") &&
                  !role.permissions.includes("property.write") && (
                    <li>View property information</li>
                  )}
                {role.permissions.includes("resident.self") && (
                  <>
                    <li>
                      Update personal contact, mailing and emergency details
                    </li>
                    <li>View approved rental information</li>
                    <li>Submit maintenance requests</li>
                    <li>
                      View lease and invitation history; contact the property
                      manager for household changes
                    </li>
                  </>
                )}
              </ul>
              {role.role === "resident" && (
                <p className="help">
                  Approved leaseholders can view shared lease finances.
                  Occupants have no financial access. Unit, lease, household
                  approval and role changes stay with management.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      <details className="account-disclosure">
        <summary>How access is checked</summary>
        <p>
          Protected actions require a verified, active account and active
          company membership. Resident lease access also requires current
          property assignment and an approved leaseholder relationship.
          Disabling access preserves the business records.
        </p>
        <p>
          Every signed-in user can maintain their personal profile. A profile
          edit cannot change a unit assignment, lease, company membership or
          role.
        </p>
      </details>
    </div>
  );
}
