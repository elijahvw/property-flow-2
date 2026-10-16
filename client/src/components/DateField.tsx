import { useState, type InputHTMLAttributes } from "react";
import { formatDate } from "../dates";

// Keep native date semantics, validation, form values and calendar/keyboard
// support. The visible value uses one unambiguous month-name format everywhere.
export function DateField({ value, defaultValue, onChange, className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { "aria-label": string }) {
  const [local, setLocal] = useState(String(defaultValue ?? ""));
  const selected = value === undefined ? local : String(value ?? "");
  return <span className={`date-field ${props.disabled ? "disabled" : ""}`}>
    <span className={`date-field-display ${selected ? "" : "placeholder"}`} aria-hidden="true">{formatDate(selected, "Choose a date")}</span>
    <svg className="date-field-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18" /></svg>
    <input {...props} type="date" className={`date-field-native ${className}`} value={selected} onChange={event => { setLocal(event.target.value); onChange?.(event); }} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) { try { event.currentTarget.showPicker?.(); } catch { /* Native keyboard input remains available. */ } } }} />
  </span>;
}
