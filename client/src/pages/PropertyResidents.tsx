import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useResource } from "../useResource";
import { useAuth } from "../context/AuthContext";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { ManageResidents } from "./Workspace";
export function PropertyResidents() {
  const { propertyId = "" } = useParams(),
    { data } = useAuth();
  return (
    <Residents
      key={`${data?.user.id}:${data?.membership?.companyId}:${propertyId}`}
      id={propertyId}
    />
  );
}
function Residents({ id }: { id: string }) {
  const [managing, setManaging] = useState(false),
    property = useResource<{ id: string; name: string }>(
      `/api/company/properties/${encodeURIComponent(id)}`,
    ),
    rows = useResource<
      {
        userId: string;
        membership: { user: { name: string | null; email: string } };
      }[]
    >(
      `/api/company/properties/${encodeURIComponent(id)}/residents`,
      false,
      true,
    );
  return (
    <>
      <PropertyNavigation id={id} name={property.data?.name} external />
      <header className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">Property workspace</p>
          <h1>Residents</h1>
          <p>
            People with access to this property. Assignments and leases are
            managed separately.
          </p>
        </div>
        <button disabled={!property.data} onClick={() => setManaging(true)}>
          Manage residents
        </button>
      </header>
      <section className="panel">
        <h2>Assigned residents</h2>
        {rows.error ? (
          <p role="alert">
            {rows.error} <button onClick={rows.reload}>Try again</button>
          </p>
        ) : !rows.data ? (
          <p role="status">Loading residents…</p>
        ) : !rows.data.length ? (
          <div className="empty-state">
            <h3>No residents assigned yet</h3>
            <p>
              Choose an accepted resident to give them access to this property.
            </p>
          </div>
        ) : (
          <ul className="record-list">
            {rows.data.map((r) => (
              <li key={r.userId}>
                <div>
                  <strong>
                    {r.membership.user.name || r.membership.user.email}
                  </strong>
                  <p>{r.membership.user.email}</p>
                </div>
                <Link
                  to={`/company/residents?residentId=${encodeURIComponent(r.userId)}`}
                >
                  View resident
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {managing && property.data && (
        <ManageResidents
          property={property.data}
          close={() => {
            setManaging(false);
            rows.reload();
          }}
        />
      )}
    </>
  );
}
