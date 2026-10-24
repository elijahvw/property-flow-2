import { AccessError } from "./access.js";

export const CSV_MAX_BYTES = 256 * 1024;
export const CSV_MAX_ROWS = 500;
export type CsvSourceRow = { row: number; values: Record<string, string> };

// The two import workflows share strict RFC 4180 parsing, not validation or
// financial semantics. Source lines and quoted field contents stay intact.
export function parseCsvObjects(value: unknown, allowed: readonly string[], required: readonly string[], recordLabel: string): CsvSourceRow[] {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > CSV_MAX_BYTES || value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value)
    throw new AccessError(400, "INVALID_CSV", "Choose a nonempty UTF-8 CSV file of at most 256 KiB, without NUL characters.");
  const csv = value.replace(/^\uFEFF/, ""), records: { row: number; cells: string[] }[] = [];
  let cells: string[] = [], field = "", quoted = false, closed = false, line = 1, rowLine = 1;
  const invalid = () => new AccessError(400, "INVALID_CSV", `CSV quoting is invalid near line ${line}. Quote a whole cell and escape a double quote by doubling it.`);
  const finishField = () => { cells.push(field); field = ""; closed = false; };
  const finishRow = () => {
    finishField();
    if (!(cells.length === 1 && !cells[0].trim())) records.push({ row: rowLine, cells });
    cells = [];
    if (records.length > CSV_MAX_ROWS + 1) throw new AccessError(400, "IMPORT_TOO_LARGE", `Import at most 500 ${recordLabel} rows at a time. No partial preview was created.`);
  };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else if (char === "\r" || char === "\n") { if (char === "\r" && csv[i + 1] === "\n") i++; field += "\n"; line++; }
      else field += char;
    } else if (char === ",") finishField();
    else if (char === "\r" || char === "\n") { finishRow(); if (char === "\r" && csv[i + 1] === "\n") i++; line++; rowLine = line; }
    else if (char === '"') { if (field || closed) throw invalid(); quoted = true; }
    else { if (closed) throw invalid(); field += char; }
  }
  if (quoted) throw invalid();
  if (field || closed || cells.length) finishRow();
  const header = records.shift();
  if (!header) throw new AccessError(400, "INVALID_CSV", `Include a CSV header and at least one ${recordLabel} row.`);
  const headers = header.cells.map(cell => cell.trim());
  if (new Set(headers).size !== headers.length || headers.some(key => !allowed.includes(key)) || required.some(key => !headers.includes(key)))
    throw new AccessError(400, "INVALID_CSV_HEADERS", `Include ${required.join(", ")} once each. Supported columns: ${allowed.join(", ")}.`);
  if (!records.length) throw new AccessError(400, "INVALID_CSV", `Include at least one ${recordLabel} row after the CSV header.`);
  return records.map(record => {
    if (record.cells.length !== headers.length) throw new AccessError(400, "INVALID_CSV", `Line ${record.row} has ${record.cells.length} cells; the header has ${headers.length}. No rows were omitted.`);
    return { row: record.row, values: Object.fromEntries(headers.map((key, index) => [key, record.cells[index]])) };
  });
}
