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
  return (
    <fieldset className="form-section property-address-fields">
      <legend>Property & location</legend>
      <label>
        Property name
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={value.name || ""}
        />
      </label>
      <div className="address-fields">
        <label className="address-street">
          Street address
          <input
            name="address"
            required
            maxLength={200}
            autoComplete="street-address"
            defaultValue={value.address || ""}
          />
        </label>
        <label className="address-city">
          City
          <input
            name="city"
            required
            maxLength={200}
            autoComplete="address-level2"
            defaultValue={value.city || ""}
          />
        </label>
        <label className="address-region">
          State / region
          <input
            name="state"
            required
            maxLength={100}
            autoComplete="address-level1"
            defaultValue={value.state || ""}
          />
        </label>
        <label className="address-postal">
          Postal code
          <input
            name="zip"
            required
            maxLength={30}
            autoComplete="postal-code"
            defaultValue={value.zip || ""}
          />
        </label>
      </div>
    </fieldset>
  );
}
