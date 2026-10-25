import { useEffect, useState } from "react";

// Only use this for an already complete list. Server-paged directories retain
// their own source cursors and complete filtered totals.
export function useDirectoryPage<T>(items: readonly T[] | undefined, filterKey: string, pageSize = 25) {
  const [selection, setSelection] = useState({ key: filterKey, page: 0 });
  const lastPage = Math.max(0, Math.ceil((items?.length || 0) / pageSize) - 1);
  const page = selection.key === filterKey ? Math.min(selection.page, lastPage) : 0;
  useEffect(() => {
    if (selection.key !== filterKey || selection.page !== page)
      setSelection({ key: filterKey, page });
  }, [filterKey, page, selection.key, selection.page]);
  return {
    page,
    pageSize,
    items: items?.slice(page * pageSize, (page + 1) * pageSize),
    setPage: (next: number) => setSelection({ key: filterKey, page: Math.max(0, Math.min(next, lastPage)) }),
  };
}

export function DirectoryPagination({ name, page, pageSize, total, setPage }: {
  name: string; page: number; pageSize: number; total: number; setPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  return <nav className="admin-directory-pagination directory-pagination" aria-label={`${name} pages`}>
    <p aria-live="polite">Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} matching {name.toLowerCase()}</p>
    <div className="actions">
      <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous {name.toLowerCase()}</button>
      <span>Page {page + 1} of {Math.ceil(total / pageSize)}</span>
      <button type="button" className="secondary" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(page + 1)}>Next {name.toLowerCase()}</button>
    </div>
  </nav>;
}
