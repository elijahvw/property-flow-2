import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { EditorDialog } from "./EditorDialog";
import { NavigationIcon } from "./NavigationIcon";
import { useResource } from "../useResource";
import { useAuth } from "../context/AuthContext";
import { availableFeatureRoute, featureKeysForPage } from "../company-features";
import { matchingWorkspaceDestinations, workspaceDestinations } from "../navigation";
import "./PropertySearch.css";

export function PropertySearch() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // Close after navigation succeeds. Canceling a leave warning keeps the query
  // and result available, together with the unfinished source editor.
  useEffect(() => { setOpen(false); }, [location.key]);
  useEffect(() => {
    const show = () => {
      if (document.querySelector("dialog[open]:not(:has(.property-finder)), .sidebar.mobile-open")) return;
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector("dialog[open]:not(:has(.property-finder)), .sidebar.mobile-open")) return;
        setOpen(value => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("workspace-search-open", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("workspace-search-open", show);
    };
  }, []);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  return <>
    <button className="property-search-trigger" onClick={() => setOpen(true)}
      aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k">
      <span aria-hidden="true">⌕</span> Search workspace <kbd>{shortcut}</kbd>
    </button>
    <EditorDialog draftable={false} open={open} title="Search workspace" onClose={() => setOpen(false)}>
      <SearchResults />
    </EditorDialog>
  </>;
}

function SearchResults() {
  const { data } = useAuth();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const resultsId = useId(), helpId = useId();
  const term = query.trim().toLocaleLowerCase();
  const canFindProperties = !!data?.permissions.includes("property.read") && availableFeatureRoute("/company/properties", data?.companyFeatures, data?.membership?.role);
  const destinations = workspaceDestinations(data?.permissions || []).filter(destination =>
    availableFeatureRoute(destination.path, data?.companyFeatures, data?.membership?.role),
  );
  const matchingPages = matchingWorkspaceDestinations(destinations, query);
  const pages = matchingPages.slice(0, term ? 20 : 6);
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const links = () => Array.from(results.current?.querySelectorAll<HTMLAnchorElement>("a") || []);
  return <div className="property-finder workspace-finder">
    <div className="property-finder-query">
      <label htmlFor={`${resultsId}-query`}>Search workspace</label>
      <div className="property-finder-input">
        <input id={`${resultsId}-query`} ref={input} type="search" maxLength={200} value={query}
          onChange={event => setQuery(event.target.value)} placeholder={canFindProperties ? "Page, property name or address" : "Page name or task"}
          aria-describedby={helpId} aria-controls={resultsId}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); links()[0]?.focus(); }
            if (event.key === "ArrowUp") { event.preventDefault(); links().at(-1)?.focus(); }
            if (event.key === "Enter") { event.preventDefault(); links()[0]?.click(); }
          }} />
        {query && <button type="button" className="secondary" onClick={() => { setQuery(""); input.current?.focus(); }}>Clear</button>}
      </div>
      <p id={helpId} className="help">{canFindProperties ? "Jump to a page or find a property without losing your place." : "Find a page available in your current workspace."}</p>
    </div>
    <div id={resultsId} ref={results} className="workspace-finder-results"
      onKeyDown={event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = links(), index = rows.indexOf(document.activeElement as HTMLAnchorElement);
        if (index < 0) return;
        event.preventDefault();
        (rows[index + (event.key === "ArrowDown" ? 1 : -1)] || input.current)?.focus();
      }}>
      <section aria-label="Workspace pages" className="workspace-finder-pages">
        <h3>{term ? "Pages" : "Suggested pages"}</h3>
        {pages.length ? <ul className="property-finder-list">
          {pages.map(destination => <li key={destination.path}><Link to={destination.path}>
            <NavigationIcon path={destination.path} />
            <span><strong>{destination.title}</strong><span className="property-finder-address">{destination.group}{featureKeysForPage(destination.path, data?.membership?.role).some(key => data?.companyFeatures?.[key] === "read_only") ? " · Read only" : ""}</span></span>
            <span className="property-finder-open" aria-hidden="true">Open page →</span>
          </Link></li>)}
        </ul> : <p className="help">No pages match. Try a task such as rent, repairs, people or reports.</p>}
        {!!term && matchingPages.length > pages.length && <p className="help">Showing the first {pages.length} matching pages. Add another word to narrow your search.</p>}
      </section>
      {canFindProperties && (term ? <PropertyResults term={term} /> : <section className="property-finder-results" aria-label="Property search results"><h3>Properties</h3><p className="help">Enter a property name or street address to open its workspace.</p></section>)}
      {!canFindProperties && !term && <p className="help workspace-finder-tip">Search by a page name or the task you want to finish.</p>}
    </div>
    <div className="property-finder-footer">
      {canFindProperties ? <Link to="/company/properties">Browse all properties</Link> : <Link to="/help">Open Help</Link>}
      <span className="help">↑ ↓ to choose · Enter to open · Esc to close</span>
    </div>
  </div>;
}

function PropertyResults({ term }: { term: string }) {
  // Fetch properties only for a typed query under current role/feature access.
  // Empty task searches and other roles never request property records.
  const resource = useResource<{ id: string; name: string; address: string }[]>("/api/company/properties");
  const matches = resource.data?.filter(property => `${property.name} ${property.address}`.toLocaleLowerCase().includes(term)) || [];
  const rows = matches.slice(0, 20);
  return <section className="property-finder-results" aria-label="Property search results">
    <h3>Properties</h3>
    {resource.error ? <div role="alert"><p>{resource.error}</p><button type="button" className="secondary" onClick={resource.reload}>Try again</button></div>
      : !resource.data ? <p role="status">Loading properties…</p>
      : !resource.data.length ? <div className="property-finder-empty"><h4>No properties yet</h4><p>Your company’s properties will appear here once they are added.</p></div>
      : !rows.length ? <div className="property-finder-empty" role="status"><h4>No properties found</h4><p>Try part of the property name or a different street address.</p></div>
      : <>
        <p className="property-finder-count" role="status">{matches.length === 1 ? "1 matching property" : `${matches.length} matching properties`}{matches.length > rows.length ? ` · Showing the first ${rows.length}` : ""}</p>
        <ul className="property-finder-list">{rows.map(property => <li key={property.id}><Link to={`/company/properties/${encodeURIComponent(property.id)}`}>
          <NavigationIcon path="/company/properties" />
          <span><strong>{property.name}</strong><span className="property-finder-address">{property.address}</span></span>
          <span className="property-finder-open" aria-hidden="true">Open property →</span>
        </Link></li>)}</ul>
        {matches.length > rows.length && <p className="help">Add more of the name or address to narrow your results.</p>}
      </>}
  </section>;
}
