import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { EditorDialog } from "./EditorDialog";
import { useResource } from "../useResource";
import "./PropertySearch.css";

export function PropertySearch() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // Close only after navigation succeeds; a canceled draft warning must keep
  // the query and selected result available.
  useEffect(() => { setOpen(false); }, [location.key]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Finish or close the current editor before opening global navigation.
        // A second dialog could otherwise navigate away from unfinished work.
        if (document.querySelector("dialog[open]:not(:has(.property-finder))")) return;
        setOpen(value => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  return (
    <>
      <button className="property-search-trigger" onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k">
        <span aria-hidden="true">⌕</span> Find a property <kbd>{shortcut}</kbd>
      </button>
      <EditorDialog draftable={false} open={open} title="Find a property" onClose={() => setOpen(false)}>
        <SearchResults />
      </EditorDialog>
    </>
  );
}

function SearchResults() {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const resultsId = useId();
  const helpId = useId();
  const resource = useResource<{ id: string; name: string; address: string }[]>("/api/company/properties");
  const term = query.trim().toLocaleLowerCase();
  const matches = resource.data?.filter(property => `${property.name} ${property.address}`.toLocaleLowerCase().includes(term)) || [];
  const rows = matches.slice(0, 20);
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const links = () => Array.from(results.current?.querySelectorAll<HTMLAnchorElement>("a") || []);
  return (
    <div className="property-finder">
      <div className="property-finder-query">
        <label htmlFor={`${resultsId}-query`}>Search properties</label>
        <div className="property-finder-input">
          <input id={`${resultsId}-query`} ref={input} type="search" maxLength={200} value={query}
            onChange={event => setQuery(event.target.value)} placeholder="Property name or address"
            aria-describedby={helpId} aria-controls={resultsId}
            onKeyDown={event => {
              if (!term) return;
              if (event.key === "ArrowDown") { event.preventDefault(); links()[0]?.focus(); }
              if (event.key === "ArrowUp") { event.preventDefault(); links().at(-1)?.focus(); }
              if (event.key === "Enter") { event.preventDefault(); links()[0]?.click(); }
            }} />
          {query && <button type="button" className="secondary" onClick={() => { setQuery(""); input.current?.focus(); }}>Clear</button>}
        </div>
        <p id={helpId} className="help">Search this company’s properties, then open a property workspace.</p>
      </div>
      <section id={resultsId} className="property-finder-results" aria-label="Property search results">
        {resource.error ? (
          <div role="alert"><p>{resource.error}</p><button type="button" className="secondary" onClick={resource.reload}>Try again</button></div>
        ) : !resource.data ? (
          <p role="status">Loading properties…</p>
        ) : !resource.data.length ? (
          <div className="property-finder-empty"><h3>No properties yet</h3><p>Your company’s properties will appear here once they are added.</p></div>
        ) : !term ? (
          <div className="property-finder-empty"><h3>Which property do you need?</h3><p>Enter a name or street address above. To review your portfolio, browse all properties below.</p></div>
        ) : !rows.length ? (
          <div className="property-finder-empty" role="status"><h3>No properties found</h3><p>Try part of the property name or a different street address.</p></div>
        ) : (
          <>
            <p className="property-finder-count" role="status">{matches.length === 1 ? "1 matching property" : `${matches.length} matching properties`}{matches.length > rows.length ? ` · Showing the first ${rows.length}` : ""}</p>
            <ul ref={results} className="property-finder-list"
              onKeyDown={event => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                const rows = links();
                const index = rows.indexOf(document.activeElement as HTMLAnchorElement);
                if (index < 0) return;
                event.preventDefault();
                const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
                (next || input.current)?.focus();
              }}>
              {rows.map(property => <li key={property.id}>
                <Link to={`/company/properties/${encodeURIComponent(property.id)}`}>
                  <span><strong>{property.name}</strong><span className="property-finder-address">{property.address}</span></span>
                  <span className="property-finder-open" aria-hidden="true">Open property →</span>
                </Link>
              </li>)}
            </ul>
            {matches.length > rows.length && <p className="help">Add more of the name or address to narrow your results.</p>}
          </>
        )}
      </section>
      <div className="property-finder-footer">
        <Link to="/company/properties">Browse all properties</Link>
        <span className="help">↑ ↓ to choose · Enter to open · Esc to close</span>
      </div>
    </div>
  );
}
