export type PropertyExtras = {
  propertyType?: string | null;
  yearBuilt?: number | null;
  parcelId?: string | null;
  countryCode?: string | null;
  notes?: string | null;
};
export type UnitExtras = {
  bedrooms?: number | null;
  bathroomsHundredths?: number | null;
  squareFeet?: number | null;
  marketRentCents?: number | null;
  floor?: string | null;
  notes?: string | null;
};
export const propertyTypes = [
  ["single_family", "Single-family"],
  ["multi_family", "Multifamily"],
  ["condo", "Condominium"],
  ["townhouse", "Townhouse"],
  ["commercial", "Commercial"],
  ["mixed_use", "Mixed use"],
  ["other", "Other"],
];
export function PropertyFields({ value = {} }: { value?: PropertyExtras }) {
  return (
    <>
      <fieldset className="editor-section">
        <legend>Building details</legend>
        <div className="form-grid">
          <label>
            Property type
            <select name="propertyType" defaultValue={value.propertyType || ""}>
              <option value="">Not recorded</option>
              {propertyTypes.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year built
            <input
              type="number"
              name="yearBuilt"
              min="1000"
              max="2100"
              step="1"
              defaultValue={value.yearBuilt ?? ""}
            />
          </label>
          <label>
            Parcel / tax ID
            <input
              name="parcelId"
              maxLength={100}
              defaultValue={value.parcelId || ""}
            />
          </label>
          <label>
            Country code
            <input
              name="countryCode"
              placeholder="US"
              maxLength={2}
              pattern="[A-Za-z]{2}"
              defaultValue={value.countryCode || ""}
            />
          </label>
        </div>
        <label>
          Property notes
          <textarea
            name="notes"
            maxLength={2000}
            rows={3}
            defaultValue={value.notes || ""}
          />
        </label>
        <p className="help">
          Optional details help your team keep a complete record. Blank means
          not recorded.
        </p>
      </fieldset>
    </>
  );
}
export function UnitFields({ value = {} }: { value?: UnitExtras }) {
  return (
    <fieldset className="editor-section">
      <legend>Unit details</legend>
      <div className="form-grid">
        <label>
          Bedrooms
          <input
            name="bedrooms"
            type="number"
            min="0"
            max="100"
            step="1"
            defaultValue={value.bedrooms ?? ""}
          />
          <span className="help">Use 0 for a studio.</span>
        </label>
        <label>
          Bathrooms
          <input
            name="bathrooms"
            type="number"
            min="0"
            max="100"
            step="0.25"
            defaultValue={
              value.bathroomsHundredths == null
                ? ""
                : value.bathroomsHundredths / 100
            }
          />
        </label>
        <label>
          Square feet
          <input
            name="squareFeet"
            type="number"
            min="1"
            max="10000000"
            step="1"
            defaultValue={value.squareFeet ?? ""}
          />
        </label>
        <label>
          Market rent (USD / month)
          <input
            name="marketRent"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={
              value.marketRentCents == null
                ? ""
                : (value.marketRentCents / 100).toFixed(2)
            }
          />
          <span className="help">
            An asking amount; lease rent is recorded separately.
          </span>
        </label>
        <label>
          Floor
          <input name="floor" maxLength={40} defaultValue={value.floor || ""} />
        </label>
      </div>
      <label>
        Unit notes
        <textarea
          name="notes"
          maxLength={2000}
          rows={3}
          defaultValue={value.notes || ""}
        />
      </label>
    </fieldset>
  );
}
