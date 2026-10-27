import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { helpArticles } from "../help-content";
import "./Help.css";

export function Help() {
  const { articleId } = useParams(), { user, can, data } = useAuth(), [search, setSearch] = useState("");
  const article = helpArticles.find(item => item.id === articleId);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return helpArticles;
    const words = query.split(/\s+/);
    const matches = (text: string) => words.every(word => text.toLowerCase().includes(word));
    return helpArticles.map(item => {
      let relevance = 0;
      if (matches(item.title)) relevance = 3;
      else if (matches(item.summary)) relevance = 2;
      else if (matches(`${item.title} ${item.summary} ${item.audience} ${item.steps.join(" ")} ${item.notes.join(" ")}`)) relevance = 1;
      return { item, relevance };
    }).filter(result => result.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance)
      .map(result => result.item);
  }, [search]);
  return <div className="help-center">
    <header className="page-heading"><p className="eyebrow">Support & guidance</p><h1>{article ? article.title : "Help Center"}</h1><p>{article ? article.summary : "Practical guides for your next task, from getting started to managing daily work."}</p>{user?.status === "active" && user.emailVerified && !!data?.permissions.length && <button className="secondary" onClick={() => window.dispatchEvent(new Event("pf-guide-replay"))}>Replay walkthrough</button>}</header>
    {articleId ? article ? <>
      <Link to="/help">← All guides</Link><article className="panel help-article"><p className="help">For {article.audience.toLowerCase()}</p><h2>How to do it</h2><ol className="help-steps">{article.steps.map((text,index)=><li key={index}>{text}</li>)}</ol><h2>Good to know</h2><ul className="help-notes">{article.notes.map(text=><li key={text}>{text}</li>)}</ul>{article.actions.some(action=>!user||!action.permission||can(action.permission)) && <nav className="actions" aria-label="Open this task">{article.actions.filter(action=>!user||!action.permission||can(action.permission)).map(action=><Link className="button secondary" key={action.path} to={action.path}>{action.label}</Link>)}</nav>}</article><section><h2>Related guides</h2><ul className="help-related">{article.related.map(id=>{const item=helpArticles.find(value=>value.id===id);return item?<li key={id}><Link to={`/help/${id}`}>{item.title}</Link></li>:null;})}</ul></section>
    </> : <section className="panel"><h2>Guide not found</h2><p>Choose a guide from the Help Center.</p><Link to="/help">Browse all guides</Link></section> : <>
      <label className="help-search">Find a guide<input type="search" placeholder="Try invitations, rent, deposits or maintenance" value={search} maxLength={200} onChange={event=>setSearch(event.target.value)}/></label>
      <p className="help" role="status">{results.length} {results.length===1?"guide":"guides"}{search.trim()?" matching your search":" available"}</p>
      {results.length ? <ul className="help-directory">{results.map(item=><li key={item.id}><h2><Link to={`/help/${item.id}`}>{item.title}</Link></h2><p>{item.summary}</p><span className="help">{item.audience}</span></li>)}</ul> : <p>No guides match this search. Try a broader task name.</p>}
    </>}
    {can("platform.manage") && !data?.impersonation && (!articleId || articleId === "administration") && <section className="panel" aria-labelledby="api-reference-title">
      <h2 id="api-reference-title">API reference</h2>
      <p>Browse documented endpoints, access rules and validation coverage. The reference is read-only and uses your own platform-owner session.</p>
      <a className="button secondary" href="/api/docs/">Open API reference</a>
    </section>}
    <p className="help">For account or property-specific help, contact your company owner or property manager. Never send a password or private invitation link in a support note.</p>
  </div>;
}
