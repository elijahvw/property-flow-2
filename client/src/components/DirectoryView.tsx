import { useRef, type ReactNode } from "react";
import "./DirectoryView.css";

export type DirectoryFilter = {
  key: string;
  label: string;
  value: string;
  remove: () => void;
};

// Presentation only: callers own URL context, authorized data and paging.
export function DirectoryView({ filters, clear, summary, scope, label = "Current directory view" }: {
  filters: DirectoryFilter[];
  clear: () => void;
  summary: ReactNode;
  scope?: string;
  label?: string;
}) {
  const resultSummary = useRef<HTMLDivElement>(null);
  const update = (action: () => void) => { action(); resultSummary.current?.focus({ preventScroll: true }); };
  return <div className="directory-view" aria-label={label}>
    <div ref={resultSummary} tabIndex={-1} className="directory-view-summary directory-result-summary">
      <div>{summary}{scope && <p className="directory-view-scope">{scope}</p>}</div>
      {!!filters.length && <button className="text-button" type="button" onClick={() => update(clear)}>Clear filters</button>}
    </div>
    {!!filters.length && <div className="directory-view-filters filter-chips" aria-label="Active filters">
      <span className="directory-view-filter-label">Filtered by</span>
      {filters.map(filter => <button key={filter.key} type="button" className="directory-filter-chip filter-chip" onClick={() => update(filter.remove)} aria-label={`Remove ${filter.label}: ${filter.value}`}>
        <span>{filter.label}: <strong>{filter.value}</strong></span><span aria-hidden="true">×</span>
      </button>)}
    </div>}
  </div>;
}
