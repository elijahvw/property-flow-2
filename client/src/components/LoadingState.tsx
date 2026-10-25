import "./LoadingState.css";

/** A truthful loading announcement with decorative, non-record placeholders. */
export function LoadingState({ label = "Loading records…" }: { label?: string }) {
  return <div className="loading-state" role="status">
    <p>{label}</p>
    <div className="loading-state-rows" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => <div className="loading-state-row" key={index}><span /><span /><span /></div>)}
    </div>
  </div>;
}
