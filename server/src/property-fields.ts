import { AccessError } from "./access.js";
import { boundedText, cents, choice } from "./operational.js";
export const propertyTypes = [
  "single_family",
  "multi_family",
  "condo",
  "townhouse",
  "commercial",
  "mixed_use",
  "other",
];
export const propertySelect = {
  id: true,
  name: true,
  address: true,
  city: true,
  state: true,
  zip: true,
  propertyType: true,
  yearBuilt: true,
  parcelId: true,
  countryCode: true,
  notes: true,
  version: true,
} as const;
export const propertyKeys = [
  "name",
  "address",
  "city",
  "state",
  "zip",
  "propertyType",
  "yearBuilt",
  "parcelId",
  "countryCode",
  "notes",
];
const absent = (value: unknown) =>
  value === undefined || value === null || value === "";
export function optionalText(value: unknown, max: number, label: string) {
  return absent(value) ? null : boundedText(value, max, label);
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (absent(value)) return null;
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      `${label} must be a whole number from ${min} to ${max}.`,
    );
  return Number(value);
}
export function propertyData(b: Record<string, unknown>) {
  const countryCode =
    optionalText(b.countryCode, 2, "Country code")?.toUpperCase() || null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode))
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Use a two-letter country code.",
    );
  return {
    name: boundedText(b.name, 200, "Property name"),
    address: boundedText(b.address, 200, "Street address"),
    city: boundedText(b.city, 200, "City"),
    state: boundedText(b.state, 100, "State / region"),
    zip: boundedText(b.zip, 30, "Postal code"),
    propertyType: absent(b.propertyType)
      ? null
      : choice(b.propertyType, propertyTypes, "property type"),
    yearBuilt: integer(b.yearBuilt, 1000, 2100, "Year built"),
    parcelId: optionalText(b.parcelId, 100, "Parcel ID"),
    countryCode,
    notes: optionalText(b.notes, 2000, "Property notes"),
  };
}
export const unitDetailKeys = [
  "bedrooms",
  "bathrooms",
  "squareFeet",
  "marketRent",
  "floor",
  "notes",
];
export const unitDetailSelect = {
  bedrooms: true,
  bathroomsHundredths: true,
  squareFeet: true,
  marketRentCents: true,
  floor: true,
  notes: true,
} as const;
export function unitDetails(b: Record<string, unknown>) {
  let bathroomsHundredths: number | null = null;
  if (!absent(b.bathrooms)) {
    if (
      typeof b.bathrooms !== "string" ||
      !/^\d{1,3}(?:\.\d{1,2})?$/.test(b.bathrooms)
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Bathrooms must use quarter increments from 0 to 100.",
      );
    bathroomsHundredths = cents(b.bathrooms);
    if (bathroomsHundredths > 10000 || bathroomsHundredths % 25 !== 0)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Bathrooms must use quarter increments from 0 to 100.",
      );
  }
  return {
    bedrooms: integer(b.bedrooms, 0, 100, "Bedrooms"),
    bathroomsHundredths,
    squareFeet: integer(b.squareFeet, 1, 10000000, "Square feet"),
    marketRentCents: absent(b.marketRent) ? null : cents(b.marketRent),
    floor: optionalText(b.floor, 40, "Floor"),
    notes: optionalText(b.notes, 2000, "Unit notes"),
  };
}
