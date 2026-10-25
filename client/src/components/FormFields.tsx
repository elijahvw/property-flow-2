import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import "./FormLayout.css";

type ControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/** Keeps the visible label, native constraint and help/error relationships together. */
export function FormField({ label, children, hint, error, required, id, className = "" }: {
  label: string;
  children: ReactElement<ControlProps>;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  id?: string;
  className?: string;
}) {
  const generatedId = useId(), controlId = id || children.props.id || `field-${generatedId}`;
  const isRequired = required ?? children.props.required ?? false;
  const hintId = hint ? `${controlId}-hint` : undefined, errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  return <div className={`form-field ${error ? "has-error" : ""} ${className}`}>
    <div className="form-field-heading"><label htmlFor={controlId}>{label}</label><span className={`form-field-requirement ${isRequired ? "is-required" : ""}`} aria-hidden="true">{isRequired ? "Required" : "Optional"}</span></div>
    {cloneElement(children, { id: controlId, required: isRequired, "aria-describedby": describedBy, "aria-invalid": error ? true : children.props["aria-invalid"] })}
    {hint && <p id={hintId} className="form-field-hint">{hint}</p>}
    {error && <p id={errorId} className="form-field-error">{error}</p>}
  </div>;
}

export function FormSection({ title, description, children, id, className = "" }: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const generatedId = useId(), descriptionId = `${id || generatedId}-description`;
  return <fieldset className={`editor-section form-section form-section-block ${className}`} aria-describedby={description ? descriptionId : undefined}>
    <legend id={id}>{title}</legend>
    {description && <p id={descriptionId} className="help form-section-description">{description}</p>}
    {children}
  </fieldset>;
}

/** Primary and secondary actions share a layout without changing submission behavior. */
export function FormActions({ children, secondary, secondaryDisabled = false, status }: {
  children: ReactNode;
  secondary?: ReactNode;
  secondaryDisabled?: boolean;
  status?: string;
}) {
  return <div className="actions form-actions">
    {secondary && <fieldset className="form-secondary-actions" disabled={secondaryDisabled}>{secondary}</fieldset>}
    <span className="action-spacer"/>
    {children}
    {status && <span className="form-action-status" role="status">{status}</span>}
  </div>;
}
