import React, { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";
import { useFeedback } from "./Feedback";
import { useEditorBusy } from "./EditorDialog";
import { monitorOperation } from "../operations";
import type { OperationName } from "../operation-lifecycle";
import { FormActions } from "./FormFields";
import "./FormLayout.css";

export type FormIntent = "write" | "review" | "query";
type FormSectionLink = { id: string; title: string };

export function Form({
  children,
  submit,
  label,
  operation = "account.update",
  successText,
  feedbackText,
  secondaryActions,
  reviewOnly = false,
  recovering = false,
  taskValues = false,
  locked = false,
  intent,
  sectionNavigation = true,
  timeoutMs,
}: {
  children: React.ReactNode;
  submit: (data: FormData) => Promise<void>;
  label?: string;
  operation?: OperationName;
  successText?: string;
  feedbackText?: string;
  secondaryActions?: React.ReactNode;
  reviewOnly?: boolean;
  recovering?: boolean;
  taskValues?: boolean;
  locked?: boolean;
  intent?: FormIntent;
  sectionNavigation?: boolean;
  timeoutMs?: number;
}) {
  const notify = useFeedback();
  const isReview = reviewOnly || intent === "review";
  const purpose: FormIntent = isReview ? "review" : intent || (operation === "page.data.load" || operation === "auth.session.restore" ? "query" : "write");
  const actionLabel = label || ({ write: "Save changes", review: "Review details", query: "Apply filters" })[purpose];
  const busyLabel = ({ write: "Saving…", review: "Preparing review…", query: "Updating…" })[purpose];
  const completionText = successText ?? ({ write: "Saved.", review: "Ready to review.", query: "" })[purpose];
  const editor = useEditorBusy(),
    formId = useId();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  // Recovery is initialized from a feature's submitted journal, never from an
  // unsubmitted draft. After a lost response, freeze exactly the attempted data.
  const [uncertain, setUncertain] = useState(recovering);
  const retryData = useRef<FormData | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null), formElement = useRef<HTMLFormElement>(null), nextSectionId = useRef(0);
  const [sections, setSections] = useState<FormSectionLink[]>([]), [requiredCount, setRequiredCount] = useState(0);
  const holdRequiredGuidance = useRef(false);
  // Busy/uncertain fieldsets freeze an already-reviewed form temporarily. They
  // do not change which details the user had to supply. Keep its guidance in
  // place until normal editing resumes, then read actual native constraints.
  holdRequiredGuidance.current = busy || editor.busy || uncertain;
  useEffect(() => {
    const form = formElement.current;
    if (!form) return;
    const available = (element: HTMLElement) => {
      if (element.closest("[hidden]")) return false;
      for (let parent = element.parentElement; parent && parent !== form; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement && !parent.open) return false;
        else if (getComputedStyle(parent).display === "none" || getComputedStyle(parent).visibility === "hidden") return false;
      return true;
    };
    const scan = () => {
      const legends = Array.from(form.querySelectorAll<HTMLLegendElement>(".workflow-fields fieldset > legend")).filter(available);
      // Nested groups remain with their parent; the outline follows the main
      // sections rather than listing every subsidiary choice.
      const headings = legends.filter(legend => !legends.some(other => other !== legend && other.parentElement?.contains(legend.parentElement)));
      const next = headings.map(legend => {
        if (!legend.id) legend.id = `${formId}-section-${++nextSectionId.current}`;
        legend.tabIndex = -1;
        return { id: legend.id, title: legend.textContent?.trim() || "" };
      }).filter(section => section.title);
      setSections(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      const count = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[required], select[required], textarea[required]"))
        .filter(field => field.type !== "hidden" && field.willValidate && available(field)).length;
      if (!holdRequiredGuidance.current) setRequiredCount(count);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(form, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "open", "required", "disabled"] });
    return () => observer.disconnect();
  }, [formId, children]);
  useEffect(() => {
    if (!error) return;
    errorSummary.current?.focus({ preventScroll: true });
    errorSummary.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  useEffect(() => {
    editor.recovery(formId, uncertain);
    return () => editor.recovery(formId, false);
  }, [uncertain, editor.recovery, formId]);
  useEffect(() => {
    editor.register(formId, busy);
    return () => editor.register(formId, false);
  }, [busy, editor.register, formId]);
  return (
    <form
      ref={formElement}
      className={`workflow-form workflow-form-${purpose}`}
      aria-busy={busy || undefined}
      onInputCapture={() => { if (saved) setSaved(false); }}
      onChangeCapture={() => { if (saved) setSaved(false); }}
      data-task-values={taskValues || undefined}
      onInvalidCapture={event => {
        let section = event.target instanceof HTMLElement ? event.target.closest("details") : null;
        while (section) {
          section.open = true;
          section = section.parentElement?.closest("details") || null;
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || editor.busy || locked) return;
        const form = event.currentTarget;
        const data = retryData.current || new FormData(form);
        setBusy(true);
        setError("");
        setSaved(false);
        notify("");
        try {
          await monitorOperation(operation, () => submit(data), timeoutMs ?? (operation === "sales_demo.create" || operation === "sales_demo.teardown" ? 180000 : operation.startsWith("document.") ? 60000 : undefined));
          if (!isReview) editor.completed(form);
          retryData.current = null;
          setUncertain(false);
          setSaved(true);
          if (purpose === "write")
            notify(
              feedbackText ||
              (
                {
                  "property.create": "Property created.",
                  "unit.create": "Unit created.",
                  "unit.update": "Unit saved.",
                  "lease.create": "Lease recorded.",
                  "lease.update": "Lease saved.",
                  "finance.create": "Transaction recorded.",
                  "rent.charge": "Rent posted. Balance updated.",
                  "deposit.setup": "Deposit requirement saved.",
                  "deposit.update": "Deposit requirement changed; history retained.",
                  "deposit.receipt": "Deposit received. Held balance updated.",
                  "deposit.void": "Deposit correction saved; history retained.",
                  "rent.payment": "Payment recorded. Balance updated.",
                  "rent.void": "Correction saved; history retained.",
                  "finance.void": "Correction saved; history retained.",
                  "membership.update": "Resident or membership changes saved.",
                  "maintenance.create": "Maintenance request submitted.",
                  "maintenance.status": "Request status updated.",
                  "invitation.create":
                    "Invitation created. Copy its link to share.",
                  "company.create": "Company created.",
                  "company.update": "Company saved.",
                } as Record<string, string>
              )[operation] || "Changes saved.",
            );
        } catch (e) {
          if (!isReview && e instanceof ApiError && e.submissionUncertain) {
            retryData.current = data;
            setUncertain(true);
          }
          setError(e instanceof Error ? e.message : purpose === "query" ? "Unable to update this view." : purpose === "review" ? "Unable to prepare this review." : "Unable to save changes.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {sectionNavigation && purpose !== "query" && sections.length >= 3 && <nav className="form-section-navigation" aria-label="Form sections">
        <p>In this form</p>
        <ol>{sections.map((section, index) => <li key={section.id}><button type="button" onClick={() => {
          const heading = document.getElementById(section.id);
          if (!heading || !formElement.current?.contains(heading)) return;
          heading.scrollIntoView({ block: "start" });
          heading.focus({ preventScroll: true });
        }}><span aria-hidden="true">{index + 1}</span>{section.title}</button></li>)}</ol>
      </nav>}
      {requiredCount > 0 && purpose !== "query" && <p className="form-requirements">{requiredCount} required {requiredCount === 1 ? "field" : "fields"} in this form. Complete the required details before {purpose === "review" ? "reviewing" : "submitting"}.</p>}
      {error && <div ref={errorSummary} className="workflow-error-summary notice error" role="alert" tabIndex={-1} aria-labelledby={`${formId}-error-title`}>
        <strong id={`${formId}-error-title`}>We couldn’t complete this request</strong>
        <p>{error}</p>
        {uncertain && <p>This request may already be saved. Retry with the original details before starting another record.</p>}
      </div>}
      <fieldset disabled={busy || editor.busy || locked}>
        <fieldset className="workflow-fields" disabled={uncertain && !!retryData.current}>{children}</fieldset>
        <FormActions secondary={secondaryActions} secondaryDisabled={uncertain} status={saved ? completionText : undefined}>
          <button type="submit">{busy ? busyLabel : actionLabel}</button>
        </FormActions>
      </fieldset>
      {uncertain && !error && <p className="notice">This request may already be saved. Retry with the original details before starting another record.</p>}
    </form>
  );
}
