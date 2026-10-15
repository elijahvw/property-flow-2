type Cell = string | { numeric: string };
export function moneyCell(cents: string): Cell {
  const value = BigInt(cents),
    a = value < 0n ? -value : value;
  return {
    numeric: `${value < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`,
  };
}
export function reportCsv(rows: Cell[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => {
            if (typeof cell !== "string") {
              if (!/^-?\d+\.\d{2}$/.test(cell.numeric))
                throw new Error("Invalid numeric export cell");
              return cell.numeric;
            }
            const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(cell)
              ? `'${cell}`
              : cell;
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export function downloadReport(filename: string, rows: Cell[][]) {
  const url = URL.createObjectURL(
    new Blob([reportCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
