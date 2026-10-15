import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EditorDialog } from "./EditorDialog";
import { useResource } from "../useResource";
export function PropertySearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button className="property-search-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⌕</span> Find a property <kbd>⌘ K</kbd>
      </button>
      <EditorDialog
        open={open}
        title="Find a property"
        onClose={() => setOpen(false)}
      >
        <SearchResults close={() => setOpen(false)} />
      </EditorDialog>
    </>
  );
}
function SearchResults({ close }: { close: () => void }) {
  const [query, setQuery] = useState(""),
    r = useResource<{ id: string; name: string; address: string }[]>(
      "/api/company/properties",
    );
  const rows = r.data
    ?.filter((p) =>
      `${p.name} ${p.address}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    )
    .slice(0, 20);
  return (
    <>
      <label>
        Search properties
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Property name or address"
        />
      </label>
      {r.error ? (
        <p role="alert">
          {r.error} <button onClick={r.reload}>Try again</button>
        </p>
      ) : !rows ? (
        <p role="status">Loading properties…</p>
      ) : !rows.length ? (
        <p>No properties match.</p>
      ) : (
        <ul className="search-results">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                to={`/company/properties/${encodeURIComponent(p.id)}`}
                onClick={close}
              >
                <strong>{p.name}</strong>
                <span>{p.address}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="help">
        Showing up to 20 matching properties. Type to narrow your search.
      </p>
    </>
  );
}
