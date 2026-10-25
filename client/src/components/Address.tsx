import { FormField, FormSection } from "./FormFields";

type AddressValue = {
  street?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};
/** Keep postal addresses together in reading order, including narrow screens. */
export function Address({
  street,
  line2,
  city,
  region,
  postalCode,
  country,
}: AddressValue) {
  const locality = [city, [region, postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const lines = [street, line2, locality, country].filter(Boolean);
  return (
    <span className="postal-address">
      {lines.length
        ? lines.map((line, i) => <span key={i}>{line}</span>)
        : "Not supplied"}
    </span>
  );
}
export function PropertyAddressFields({
  value = {},
}: {
  value?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}) {
  return <FormSection title="Property & location" className="property-address-fields" description="Record the property name and postal address so your team can identify this location.">
    <FormField label="Property name"><input name="name" required maxLength={200} defaultValue={value.name || ""}/></FormField>
    <div className="address-fields">
      <FormField label="Street address" className="address-street"><input name="address" required maxLength={200} autoComplete="street-address" defaultValue={value.address || ""}/></FormField>
      <FormField label="City" className="address-city"><input name="city" required maxLength={200} autoComplete="address-level2" defaultValue={value.city || ""}/></FormField>
      <FormField label="State / region" className="address-region"><input name="state" required maxLength={100} autoComplete="address-level1" defaultValue={value.state || ""}/></FormField>
      <FormField label="Postal code" className="address-postal"><input name="zip" required maxLength={30} autoComplete="postal-code" defaultValue={value.zip || ""}/></FormField>
    </div>
  </FormSection>;
}
