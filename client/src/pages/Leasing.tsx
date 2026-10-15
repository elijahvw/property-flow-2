import {
  LeaseReview,
  leasePending,
  type LeaseReviewData,
} from "../components/LeaseReview";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { UnitFields, type UnitExtras } from "../components/PropertyFields";
import { EditorDialog } from "../components/EditorDialog";
import { DraftReset } from "../components/DraftReset";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { Form } from "./Workspace";
type Unit = UnitExtras & {
  id: string;
  propertyId: string;
  label: string;
  status: string;
  version: number;
};
type Lease = {
  previousLeaseId?: string | null;
  previousLease?: { id: string; endsOn: string | null; status: string } | null;
  renewals?: { id: string; status: string; startsOn: string }[];
  rentDueDay?: number;
  graceDays?: number;
  paymentInstructions?: string | null;
  id: string;
  propertyId: string;
  unitId: string;
  residentId: string;
  startsOn: string;
  endsOn: string | null;
  rentCents: number;
  currency: string;
  status: string;
  version: number;
  unit: { label: string };
  property: { name: string };
  resident: { name: string | null; email: string };
};
type Records<T> = { items: T[]; nextCursor: string | null };
const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function Load({
  error,
  retry,
  label,
}: {
  error?: string;
  retry: () => void;
  label: string;
}) {
  return error ? (
    <div role="alert">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading {label}…</p>
  );
}
function Pager({
  next,
  cursor,
  change,
}: {
  next: string | null;
  cursor: string;
  change: (value: string) => void;
}) {
  return (
    <div className="actions">
      {cursor && (
        <button className="secondary" onClick={() => change("")}>
          First page
        </button>
      )}
      {next && (
        <button className="secondary" onClick={() => change(next)}>
          Next page
        </button>
      )}
    </div>
  );
}
export function Units() {
  const { propertyId = "" } = useParams(),
    { data, can } = useAuth();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return (
    <UnitList
      key={`${scope}:${propertyId}`}
      propertyId={propertyId}
      editable={can("property.write")}
    />
  );
}
function UnitList({
  propertyId,
  editable,
}: {
  propertyId: string;
  editable: boolean;
}) {
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<Unit | null>(null);
  const [cursor, setCursor] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [error, setError] = useState("");
  const property = useResource<{ id: string; name: string }>(
    `/api/company/properties/${encodeURIComponent(propertyId)}`,
  );
  const r = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(cursor ? { cursor } : {})}`,
    true,
    true,
  );
  const reload = () => {
    setCursor("");
    r.reload();
    setError("");
  };
  return (
    <>
      <PropertyNavigation id={propertyId} name={property.data?.name} external />
      <nav className="sr-only" aria-label="Breadcrumb">
        <Link to="/company/properties">Properties</Link> /{" "}
        <Link to={`/company/properties/${encodeURIComponent(propertyId)}`}>
          Property details
        </Link>{" "}
        / Units
      </nav>
      <header className="page-heading">
        <p className="eyebrow">Property operations</p>
        <h1>Units</h1>
        <p>
          Unit records are separate from resident property access. Archive a
          unit to retain its history; end its active lease first.
        </p>
        {editable && (
          <button disabled={!property.data} onClick={() => setAdding(true)}>
            Add a unit
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {!property.data ? (
        <Load error={property.error} retry={property.reload} label="property" />
      ) : (
        <>
          {editable && (
            <EditorDialog
              open={adding}
              title="Add a unit"
              onClose={() => setAdding(false)}
            >
              <Form
                key={key}
                operation="unit.create"
                secondaryActions={
                  <DraftReset reset={() => setKey(crypto.randomUUID())} />
                }
                label="Create unit"
                submit={async (form) => {
                  await api(
                    `/api/company/properties/${encodeURIComponent(propertyId)}/units`,
                    {
                      method: "POST",
                      body: { ...Object.fromEntries(form), submissionKey: key },
                    },
                  );
                  reload();
                  setAdding(false);
                  setKey(crypto.randomUUID());
                }}
              >
                <label>
                  Unit name
                  <input
                    name="label"
                    required
                    maxLength={80}
                    placeholder="Apartment 1 or Main house"
                  />
                </label>
                <UnitFields />
                <p className="help">
                  Choose a name that identifies this space within the property.
                </p>
              </Form>
            </EditorDialog>
          )}
          <section className="panel">
            <h2>Unit records</h2>
            {r.data && r.error && (
              <Load error={r.error} retry={r.reload} label="units" />
            )}

            {!r.data ? (
              <Load error={r.error} retry={r.reload} label="units" />
            ) : (
              <>
                <p role="status">{r.data.items.length} units on this page</p>
                {!r.data.items.length ? (
                  <p>
                    No units yet. Add a unit for each apartment, or one unit for
                    a single-family property.
                  </p>
                ) : (
                  <ul className="record-list">
                    {r.data.items.map((unit) => (
                      <li key={unit.id}>
                        <div>
                          <h3>{unit.label}</h3>
                          <p>{unit.status}</p>
                          <p>
                            {unit.bedrooms == null
                              ? "Bedrooms not recorded"
                              : `${unit.bedrooms} bed`}{" "}
                            ·{" "}
                            {unit.bathroomsHundredths == null
                              ? "Bathrooms not recorded"
                              : `${unit.bathroomsHundredths / 100} bath`}
                            {unit.squareFeet != null
                              ? ` · ${unit.squareFeet.toLocaleString()} sq ft`
                              : ""}
                          </p>
                        </div>
                        {editable && (
                          <button
                            className="secondary"
                            onClick={() => setSelected(unit)}
                          >
                            Edit unit
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Pager
                  next={r.data.nextCursor}
                  cursor={cursor}
                  change={setCursor}
                />
              </>
            )}
          </section>
        </>
      )}
      {selected && (
        <EditorDialog
          open
          title={`Edit unit ${selected.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="unit.update"
            label={`Save unit ${selected.label}`}
            submit={async (form) => {
              try {
                await api(
                  `/api/company/units/${encodeURIComponent(selected.id)}`,
                  {
                    method: "PATCH",
                    body: {
                      ...Object.fromEntries(form),
                      label: form.get("label"),
                      status: form.get("status"),
                      expectedVersion: selected.version,
                    },
                  },
                );
                reload();
                setSelected(null);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to update selected.",
                );
                throw e;
              }
            }}
          >
            <label>
              Name for {selected.label}
              <input
                name="label"
                defaultValue={selected.label}
                required
                maxLength={80}
              />
            </label>
            <UnitFields value={selected} />
            <label>
              Status for {selected.label}
              <select name="status" defaultValue={selected.status}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </Form>
        </EditorDialog>
      )}
      {!editable && <p className="help">You have read-only unit access.</p>}
    </>
  );
}
export function Leases() {
  const { data } = useAuth();
  const [routeParams] = useSearchParams();
  const pathParams = useParams();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${pathParams.propertyId || routeParams.get("propertyId") || ""}`;
  return <LeaseList key={scope} />;
}
function LeaseList() {
  const auth = useAuth().data;
  const { propertyId: pathPropertyId } = useParams();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "lease"),
    [selected, setSelected] = useState<Lease | null>(null),
    [renewing, setRenewing] = useState<Lease | null>(null);
  const contextId = pathPropertyId || params.get("propertyId") || "",
    status = params.get("status") || "",
    attention = params.get("attention") || "";
  const [visitedProperties, setVisitedProperties] = useState<string[]>(() =>
    contextId ? [contextId] : [],
  );
  const [cursor, setCursor] = useState(""),
    [propertyId, setPropertyId] = useState(contextId);
  const properties = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const r = useResource<Records<Lease>>(
    `/api/company/leases?${new URLSearchParams(Object.entries({ cursor, propertyId: contextId, status, attention }).filter(([, value]) => value))}`,
    true,
    true,
  );
  const propertyName = properties.data?.find((p) => p.id === contextId)?.name;
  const reload = () => {
    setCursor("");
    r.reload();
  };
  return (
    <>
      {contextId && <PropertyNavigation id={contextId} />}
      <header className="page-heading">
        <p className="eyebrow">Leasing</p>
        <h1>
          {contextId
            ? `${propertyName || "Property"} · Leases`
            : "Lease records"}
        </h1>
        <p>
          Manage lease terms, residents, and monthly rent. These records track
          your leases; signed agreements and balances are managed separately.
        </p>
        {contextId && (
          <p>
            <Link to="/company/leases">View all company leases</Link>
          </p>
        )}
        <button onClick={() => setAdding(true)}>Record a lease</button>
        {properties.data
          ?.filter(
            (p) =>
              (!pathPropertyId || p.id === pathPropertyId) &&
              leasePending(
                `pf:lease-setup:${auth?.user.id}:${auth?.membership?.companyId}:${p.id}`,
              ),
          )
          .map((p) => (
            <button
              className="secondary"
              key={p.id}
              onClick={() => {
                setPropertyId(p.id);
                setVisitedProperties((ids) =>
                  ids.includes(p.id) ? ids : [...ids, p.id],
                );
                setAdding(true);
              }}
            >
              Resume lease review · {p.name}
            </button>
          ))}
      </header>
      <EditorDialog
        open={adding}
        title="Record a lease"
        description="Choose the property, unit, and resident, then add the lease terms."
        onClose={() => setAdding(false)}
      >
        {!properties.data ? (
          <Load
            error={properties.error}
            retry={properties.reload}
            label="properties"
          />
        ) : !properties.data.length ? (
          <p>Create a property and units first.</p>
        ) : (
          <>
            <label>
              Property for new lease
              <select
                value={propertyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPropertyId(id);
                  if (id)
                    setVisitedProperties((previous) =>
                      previous.includes(id) ? previous : [...previous, id],
                    );
                }}
              >
                <option value="">Choose a property</option>
                {properties.data
                  .filter((p) => !pathPropertyId || p.id === pathPropertyId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {visitedProperties.map((id) => (
              <div
                className="lease-property-draft"
                key={id}
                hidden={propertyId !== id}
              >
                <LeaseCreate
                  propertyId={id}
                  propertyName={
                    properties.data!.find((p) => p.id === id)?.name ||
                    "Property"
                  }
                  saved={() => {
                    reload();
                    setAdding(false);
                    setParams(pathPropertyId ? {} : { propertyId: id });
                  }}
                />
              </div>
            ))}
          </>
        )}
      </EditorDialog>
      <section className="panel">
        <div className="section-heading">
          <h2>
            {contextId ? "Property lease history" : "Company lease history"}
          </h2>
          <label className="compact-filter">
            Lease view
            <select
              value={attention || status}
              onChange={(e) => {
                const value = e.target.value;
                setCursor("");
                setParams({
                  ...(!pathPropertyId && contextId
                    ? { propertyId: contextId }
                    : {}),
                  ...(["ending_soon", "past_end", "in_effect"].includes(value)
                    ? { attention: value }
                    : value
                      ? { status: value }
                      : {}),
                });
              }}
            >
              <option value="">All leases</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
              <option value="in_effect">In effect today</option>
              <option value="ending_soon">Ending within 30 days</option>
              <option value="past_end">Past end, still active</option>
            </select>
          </label>
        </div>
        {r.data && r.error && (
          <Load error={r.error} retry={r.reload} label="leases" />
        )}

        {!r.data ? (
          <Load error={r.error} retry={r.reload} label="leases" />
        ) : (
          <>
            <p role="status">{r.data.items.length} leases on this page</p>
            {!r.data.items.length ? (
              <p>No lease records yet.</p>
            ) : (
              <ul className="record-list">
                {r.data.items.map((lease) => (
                  <li key={lease.id}>
                    <div>
                      <h3>
                        <span className="eyebrow">Property</span>{" "}
                        <Link
                          to={`/company/properties/${encodeURIComponent(lease.propertyId)}/leases`}
                        >
                          {lease.property.name}
                        </Link>{" "}
                        · Unit {lease.unit.label}
                      </h3>
                      <p>
                        {lease.resident.name || lease.resident.email} ·{" "}
                        {lease.status}
                      </p>
                      <p>
                        {lease.startsOn.slice(0, 10)} to{" "}
                        {lease.endsOn?.slice(0, 10) || "Open-ended"} ·{" "}
                        {usd(lease.rentCents)} monthly
                      </p>
                      {lease.previousLeaseId && (
                        <p className="help">
                          Renewal · previous term ended{" "}
                          {lease.previousLease?.endsOn?.slice(0, 10) ||
                            "on record"}
                        </p>
                      )}
                    </div>
                    <div className="actions">
                      <Link
                        to={`/company/rent?leaseId=${encodeURIComponent(lease.id)}`}
                      >
                        Rent ledger →
                      </Link>
                      {leasePending(
                        `pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${lease.id}`,
                      ) && (
                        <button
                          className="secondary"
                          onClick={() => setRenewing(lease)}
                        >
                          Resume renewal review
                        </button>
                      )}
                      {lease.status !== "draft" &&
                        lease.endsOn &&
                        !lease.renewals?.length && (
                          <button
                            className="secondary"
                            onClick={() => setRenewing(lease)}
                          >
                            Prepare renewal
                          </button>
                        )}
                      {lease.renewals?.length ? (
                        <span className="help">
                          {lease.renewals[0].status} renewal starts{" "}
                          {lease.renewals[0].startsOn.slice(0, 10)}
                        </span>
                      ) : null}
                      <button
                        className="secondary"
                        onClick={() => setSelected(lease)}
                      >
                        Edit lease
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Pager
              next={r.data.nextCursor}
              cursor={cursor}
              change={setCursor}
            />
          </>
        )}
      </section>
      <EditorDialog
        open={!!renewing}
        title="Prepare lease renewal"
        onClose={() => {
          setRenewing(null);
          reload();
        }}
      >
        {renewing && (
          <LeaseRenewal
            key={renewing.id}
            previous={renewing}
            saved={() => {
              setRenewing(null);
              reload();
              setParams({
                ...(!pathPropertyId ? { propertyId: renewing.propertyId } : {}),
                status: "draft",
              });
            }}
          />
        )}
      </EditorDialog>
      {selected && (
        <EditorDialog
          open
          title={`Edit lease · ${selected.property.name} · ${selected.unit.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="lease.update"
            label={`Save lease ${selected.unit.label}`}
            submit={async (form) => {
              await api(
                `/api/company/leases/${encodeURIComponent(selected.id)}`,
                {
                  method: "PATCH",
                  body: {
                    startsOn: form.get("startsOn"),
                    endsOn: form.get("endsOn") || null,
                    monthlyRent: form.get("monthlyRent"),
                    status: form.get("status"),
                    expectedVersion: selected.version,
                    rentDueDay: Number(form.get("rentDueDay")),
                    graceDays: Number(form.get("graceDays")),
                    paymentInstructions:
                      form.get("paymentInstructions") || null,
                  },
                },
              );
              reload();
              setSelected(null);
            }}
          >
            <LeaseTerms
              prefix={`Lease ${selected.unit.label}`}
              value={selected}
            />
          </Form>
        </EditorDialog>
      )}
    </>
  );
}
function LeaseCreate({
  propertyId,
  propertyName,
  saved,
}: {
  propertyId: string;
  propertyName: string;
  saved: () => void;
}) {
  const auth = useAuth().data,
    storageKey = `pf:lease-setup:${auth?.user.id}:${auth?.membership?.companyId}:${propertyId}`;
  const [review, setReview] = useState<LeaseReviewData | null>(() =>
    leasePending(storageKey),
  );
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [unitCursor, setUnitCursor] = useState("");
  const [unitOptions, setUnitOptions] = useState<Unit[]>([]);
  const units = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(unitCursor ? { cursor: unitCursor } : {})}`,
  );
  const residents = useResource<
    {
      userId: string;
      membership: { user: { name: string | null; email: string } };
    }[]
  >(`/api/company/properties/${encodeURIComponent(propertyId)}/residents`);
  // Browsing options must never remount a pending draft or change its retry identity.
  // Keep already-seen choices so the selected unit survives an independent page load.
  useEffect(() => {
    if (units.data)
      setUnitOptions((previous) => {
        const choices = new Map(previous.map((unit) => [unit.id, unit]));
        for (const unit of units.data!.items)
          if (unit.status === "active") choices.set(unit.id, unit);
        return [...choices.values()];
      });
  }, [units.data]);
  return (
    <>
      <div className="prerequisite-links">
        <Link
          to={`/company/properties/${encodeURIComponent(propertyId)}/residents`}
        >
          Manage residents
        </Link>{" "}
        ·{" "}
        <Link
          to={`/company/properties/${encodeURIComponent(propertyId)}/units`}
        >
          Manage units for this property
        </Link>
      </div>
      {!residents.data ? (
        <Load
          error={residents.error}
          retry={residents.reload}
          label="assigned residents"
        />
      ) : (
        <>
          {!unitOptions.length || !residents.data.length ? (
            units.data && (
              <p>
                Choose an active unit and assign an accepted resident before
                creating a lease.
              </p>
            )
          ) : (
            <>
              {review && (
                <LeaseReview
                  review={review}
                  storageKey={storageKey}
                  back={() => setReview(null)}
                  saved={() => {
                    setReview(null);
                    saved();
                    setKey(crypto.randomUUID());
                  }}
                />
              )}
              <div hidden={!!review}>
                <Form
                  key={key}
                  operation="page.data.load"
                  secondaryActions={
                    <DraftReset reset={() => setKey(crypto.randomUUID())} />
                  }
                  label="Review lease"
                  submit={async (form) => {
                    setReview({
                      property: propertyName,
                      unit:
                        unitOptions.find((u) => u.id === form.get("unitId"))
                          ?.label || "Unit",
                      resident:
                        residents.data!.find(
                          (p) => p.userId === form.get("residentId"),
                        )?.membership.user.email || "Resident",
                      payload: {
                        propertyId,
                        unitId: form.get("unitId"),
                        residentId: form.get("residentId"),
                        startsOn: form.get("startsOn"),
                        endsOn: form.get("endsOn") || null,
                        monthlyRent: form.get("monthlyRent"),
                        status: form.get("status"),
                        submissionKey: key,
                        rentDueDay: Number(form.get("rentDueDay")),
                        graceDays: Number(form.get("graceDays")),
                        paymentInstructions:
                          form.get("paymentInstructions") || null,
                      },
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Unit for new lease
                      <select name="unitId" required>
                        {unitOptions.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Primary resident
                      <select name="residentId" required>
                        {residents.data.map((person) => (
                          <option key={person.userId} value={person.userId}>
                            {person.membership.user.name ||
                              person.membership.user.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <LeaseTerms prefix="New lease" />
                  <p className="help">
                    One active lease is allowed per unit. Review the details,
                    then select Review lease before saving.
                  </p>
                </Form>
              </div>
            </>
          )}
        </>
      )}
      {!units.data ? (
        <Load error={units.error} retry={units.reload} label="units" />
      ) : (
        <Pager
          next={units.data.nextCursor}
          cursor={unitCursor}
          change={setUnitCursor}
        />
      )}
    </>
  );
}
function LeaseTerms({
  prefix,
  value,
  draftOnly = false,
}: {
  prefix: string;
  value?: Lease;
  draftOnly?: boolean;
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          {prefix} start date
          <input
            name="startsOn"
            type="date"
            required
            defaultValue={value?.startsOn.slice(0, 10)}
          />
        </label>
        <div>
          <label>
            {prefix} end date
            <input
              name="endsOn"
              type="date"
              defaultValue={value?.endsOn?.slice(0, 10)}
            />
          </label>
          <p className="help">
            Leave blank for an open-ended record; ended records require a date.
          </p>
        </div>
        <label>
          {prefix} monthly rent (USD)
          <input
            name="monthlyRent"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            required
            defaultValue={
              value ? (value.rentCents / 100).toFixed(2) : undefined
            }
          />
        </label>
        <label>
          {prefix} status
          <select
            name="status"
            defaultValue={draftOnly ? "draft" : value?.status || "draft"}
            disabled={draftOnly}
          >
            <option value="draft">Draft</option>
            {!draftOnly && <option value="active">Active</option>}
            {!draftOnly && <option value="ended">Ended</option>}
          </select>
        </label>
      </div>
      <PaymentTerms prefix={prefix} value={value} />
    </>
  );
}

function PaymentTerms({ prefix, value }: { prefix: string; value?: Lease }) {
  const [due, setDue] = useState(value?.rentDueDay ?? 1),
    [grace, setGrace] = useState(String(value?.graceDays ?? 0));
  const preview = new Date("2026-11-01T00:00:00Z");
  preview.setUTCDate(Math.min(due, 30));
  const through = new Date(preview);
  const graceNumber = Number(grace),
    validGrace =
      grace !== "" &&
      Number.isInteger(graceNumber) &&
      graceNumber >= 0 &&
      graceNumber <= 30;
  through.setUTCDate(through.getUTCDate() + (validGrace ? graceNumber : 0));
  const after = new Date(through);
  after.setUTCDate(after.getUTCDate() + 1);
  return (
    <fieldset className="editor-section payment-terms">
      <legend>Rent payment terms</legend>
      <div className="form-grid">
        <label>
          {prefix} rent due day
          <select
            name="rentDueDay"
            value={due}
            onChange={(e) => setDue(Number(e.target.value))}
          >
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Day {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {prefix} grace period (days after due date)
          <input
            name="graceDays"
            type="number"
            required
            min="0"
            max="30"
            step="1"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </label>
      </div>
      <p className="help">
        Due days 29–31 use the last day when a month is shorter. Grace is
        counted in full calendar days after the due date, in the company
        timezone.
      </p>
      <p className="policy-example">
        Example: November rent due {preview.toISOString().slice(0, 10)} · grace
        through {through.toISOString().slice(0, 10)} · past grace from{" "}
        {after.toISOString().slice(0, 10)}.
      </p>
      <label>
        {prefix} payment instructions shared with resident (optional)
        <textarea
          name="paymentInstructions"
          maxLength={1000}
          defaultValue={value?.paymentInstructions || ""}
          placeholder="How and where to send manually recorded payments"
        />
      </label>
      <p className="help">
        Settings apply to newly posted charges. Existing charges retain their
        saved grace period. No automatic late fees are charged.
      </p>
    </fieldset>
  );
}

function LeaseRenewal({
  previous,
  saved,
}: {
  previous: Lease;
  saved: () => void;
}) {
  const auth = useAuth().data,
    storageKey = `pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${previous.id}`;
  const [review, setReview] = useState<LeaseReviewData | null>(() =>
    leasePending(storageKey),
  );
  const [key] = useState(() => crypto.randomUUID());
  const start = new Date(previous.endsOn!);
  start.setUTCDate(start.getUTCDate() + 1);
  const proposed = {
    ...previous,
    startsOn: start.toISOString(),
    endsOn: null,
    status: "draft",
  };
  return (
    <>
      {review && (
        <LeaseReview
          review={review}
          storageKey={storageKey}
          back={() => setReview(null)}
          saved={saved}
        />
      )}
      <div hidden={!!review}>
        <Form
          operation="page.data.load"
          label="Review renewal"
          submit={async (f) =>
            setReview({
              property: previous.property.name,
              unit: previous.unit.label,
              resident: previous.resident.email,
              payload: {
                propertyId: previous.propertyId,
                unitId: previous.unitId,
                residentId: previous.residentId,
                previousLeaseId: previous.id,
                expectedPreviousVersion: previous.version,
                startsOn: f.get("startsOn"),
                endsOn: f.get("endsOn") || null,
                monthlyRent: f.get("monthlyRent"),
                rentDueDay: Number(f.get("rentDueDay")),
                graceDays: Number(f.get("graceDays")),
                paymentInstructions: f.get("paymentInstructions") || null,
                status: "draft",
                submissionKey: key,
              },
            })
          }
        >
          <p>
            {previous.property.name} · {previous.unit.label} ·{" "}
            {previous.resident.name || previous.resident.email}
          </p>
          <p className="notice">
            Previous term ends {previous.endsOn!.slice(0, 10)}. Review a new
            term starting afterward. This does not end the previous lease or
            stop its rent schedule.
          </p>
          <LeaseTerms prefix="Renewal" value={proposed} draftOnly />
        </Form>
      </div>
    </>
  );
}
