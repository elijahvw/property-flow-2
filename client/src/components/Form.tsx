import React, { useEffect, useId, useState } from "react";
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
}: {
  children: React.ReactNode;
  submit: (data: FormData) => Promise<void>;
  label?: string;
  operation?: OperationName;
  successText?: string;
  feedbackText?: string;
  secondaryActions?: React.ReactNode;
}) {
  const notify = useFeedback();
  const editor = useEditorBusy(),
    formId = useId();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    editor.register(formId, busy);
    return () => editor.register(formId, false);
  }, [busy, editor.register, formId]);
  return (
    <form
      className="workflow-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || editor.busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        setSaved(false);
        notify("");
        try {
          await monitorOperation(operation, () => submit(data), operation.startsWith("document.") ? 60000 : undefined);
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
          setError(e instanceof Error ? e.message : "Unable to save changes.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || editor.busy}>
        {children}
        <div className="actions form-actions">
          {secondaryActions}
          <span className="action-spacer" />
          <button type="submit">{busy ? "Saving…" : label}</button>
          {saved && <span role="status">{successText}</span>}
        </div>
      </fieldset>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
