import React, { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";
import { useFeedback } from "./Feedback";
import { useEditorBusy } from "./EditorDialog";
import { monitorOperation } from "../operations";
import type { OperationName } from "../operation-lifecycle";

export function Form({
  children,
  submit,
  label = "Save changes",
  operation = "account.update",
  successText = "Saved.",
  feedbackText,
  secondaryActions,
  reviewOnly = false,
  recovering = false,
  taskValues = false,
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
}) {
  const notify = useFeedback();
  const editor = useEditorBusy(),
    formId = useId();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  // Recovery is initialized from a feature's submitted journal, never from an
  // unsubmitted draft. After a lost response, freeze exactly the attempted data.
  const [uncertain, setUncertain] = useState(recovering);
  const retryData = useRef<FormData | null>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
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
      className="workflow-form"
      data-task-values={taskValues||undefined}
      onInvalidCapture={event => {
        // Optional sections stay compact, but a field requiring attention must
        // be visible before the browser tries to focus it.
        let section = event.target instanceof HTMLElement ? event.target.closest("details") : null;
        while (section) {
          section.open = true;
          section = section.parentElement?.closest("details") || null;
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || editor.busy) return;
        const form = event.currentTarget;
        const data = retryData.current || new FormData(form);
        setBusy(true);
        setError("");
        setSaved(false);
        notify("");
        try {
          await monitorOperation(operation, () => submit(data), operation.startsWith("document.") ? 60000 : undefined);
          if (!reviewOnly) editor.completed(form);
          retryData.current = null;
          setUncertain(false);
          setSaved(true);
          if (
            operation !== "page.data.load" &&
            operation !== "auth.session.restore"
          )
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
          if (!reviewOnly && e instanceof ApiError && e.submissionUncertain) {
            retryData.current = data;
            setUncertain(true);
          }
          setError(e instanceof Error ? e.message : "Unable to save changes.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p ref={errorSummary} className="notice error form-error-summary" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      <fieldset disabled={busy || editor.busy}>
        <fieldset disabled={uncertain && !!retryData.current}>{children}</fieldset>
        <div className="actions form-actions">
          <fieldset disabled={uncertain}>{secondaryActions}</fieldset>
          <span className="action-spacer" />
          <button type="submit">{busy ? "Saving…" : label}</button>
          {saved && <span role="status">{successText}</span>}
        </div>
      </fieldset>
      {uncertain && <p className="notice">This request may already be saved. Retry with the original details before starting another record.</p>}
    </form>
  );
}
