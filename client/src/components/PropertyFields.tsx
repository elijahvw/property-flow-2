import { FormField, FormSection } from "./FormFields";

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
  return <FormSection title="Building details" description="Optional details help your team keep a complete property record. Blank means not recorded.">
    <div className="form-grid">
      <FormField label="Property type"><select name="propertyType" defaultValue={value.propertyType || ""}>
        <option value="">Not recorded</option>{propertyTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></FormField>
      <FormField label="Year built" hint="Four digits, from 1000 to 2100."><input type="number" name="yearBuilt" min="1000" max="2100" step="1" defaultValue={value.yearBuilt ?? ""}/></FormField>
      <FormField label="Parcel / tax ID"><input name="parcelId" maxLength={100} defaultValue={value.parcelId || ""}/></FormField>
      <FormField label="Country code" hint="Two-letter country code, for example US."><input name="countryCode" placeholder="US" maxLength={2} pattern="[A-Za-z]{2}" defaultValue={value.countryCode || ""}/></FormField>
    </div>
    <FormField label="Property notes"><textarea name="notes" maxLength={2000} rows={3} defaultValue={value.notes || ""}/></FormField>
  </FormSection>;
}
export function UnitFields({ value = {} }: { value?: UnitExtras }) {
  return <FormSection title="Unit details" description="Keep the physical details and asking rent with the unit. Lease terms are recorded separately.">
    <div className="form-grid">
      <FormField label="Bedrooms" hint="Use 0 for a studio."><input name="bedrooms" type="number" min="0" max="100" step="1" defaultValue={value.bedrooms ?? ""}/></FormField>
      <FormField label="Bathrooms" hint="Use quarter-bath increments, for example 1.25."><input name="bathrooms" type="number" min="0" max="100" step="0.25" defaultValue={value.bathroomsHundredths == null ? "" : value.bathroomsHundredths / 100}/></FormField>
      <FormField label="Square feet" hint="Whole square feet."><input name="squareFeet" type="number" min="1" max="10000000" step="1" defaultValue={value.squareFeet ?? ""}/></FormField>
      <FormField label="Market rent (USD / month)" hint="An asking amount; lease rent is recorded separately."><input name="marketRent" type="number" min="0" max="1000000" step="0.01" defaultValue={value.marketRentCents == null ? "" : (value.marketRentCents / 100).toFixed(2)}/></FormField>
      <FormField label="Floor"><input name="floor" maxLength={40} defaultValue={value.floor || ""}/></FormField>
    </div>
    <FormField label="Unit notes"><textarea name="notes" maxLength={2000} rows={3} defaultValue={value.notes || ""}/></FormField>
  </FormSection>;
}
