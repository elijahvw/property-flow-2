import { parseCsvObjects } from "./csv.js";
export { CSV_MAX_BYTES as UNIT_IMPORT_MAX_BYTES, CSV_MAX_ROWS as UNIT_IMPORT_MAX_ROWS } from "./csv.js";
export type { CsvSourceRow as UnitImportSourceRow } from "./csv.js";
export const UNIT_IMPORT_COLUMNS = ["propertyId", "label", "bedrooms", "bathrooms", "squareFeet", "marketRent", "floor", "notes"] as const;
export function parseUnitCsv(value: unknown) {
  return parseCsvObjects(value, UNIT_IMPORT_COLUMNS, ["propertyId", "label"], "unit");
}
