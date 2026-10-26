import { DraftReset } from "./DraftReset";
import { useState } from "react";
import { api } from "../api";
import { Form } from "./Form";
import { ManualPassword } from "./ManualPassword";
import "./LandlordForms.css";
export function UserProvisioning({ saved }: { saved: (id?: string) => void }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <section className="account-provisioning">
      <h2>Create a sign-in account</h2>
      <p className="help">Create or reuse this person’s Auth0 account. Company access and email setup are reviewed separately.</p>
      <Form
        key={key}
        operation="user.provision"
        secondaryActions={
          <DraftReset reset={() => setKey(crypto.randomUUID())} />
        }
        label="Create account"
        submit={async (form) => {
          const created = await api<{ id: string }>(
            "/api/platform/users/provision",
            {
              method: "POST",
              body: {
                email: form.get("email"),
                name: form.get("name"),
                submissionKey: key,
              },
            },
          );
          saved(created.id);
          setKey(crypto.randomUUID());
        }}
      >
        <fieldset><legend>Account details</legend><div className="form-grid"><label>
          New user name
          <input name="name" required maxLength={200} autoComplete="name" />
        </label>
        <label>
          New user email
          <input name="email" type="email" required maxLength={254} autoComplete="email" />
        </label>
        </div><p className="help">Both fields are required. An existing exact sign-in account is reused. No email is sent automatically.</p></fieldset>
        <details className="account-setup-next"><summary>After creating the account</summary><ul>
          <li><strong>Review company access</strong><span>Choose the company and role from the selected profile.</span></li>
          <li><strong>Complete email setup</strong><span>Send a password reset or verification email from the profile when needed. Creating the account sends no email automatically.</span></li>
        </ul></details>
      </Form>
    </section>
  );
}
export function UserVerificationControls({
  id,
  verified,
  saved,
  active = true,
}: {
  id: string;
  verified?: boolean;
  saved: () => void;
  active?: boolean;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="divider">
      <h3>Sign-in and email verification</h3>
      <p>Email: {verified ? "Verified" : "Not verified"}</p>
      <Form
        operation="account.verification"
        label="Refresh verification status"
        submit={async () => {
          const result = await api<{ emailVerified: boolean }>(
            `/api/platform/users/${encodeURIComponent(id)}/verification-status`,
            { method: "POST", body: {} },
          );
          setMessage(
            result.emailVerified
              ? "Email is verified."
              : "Email is not verified.",
          );
          saved();
        }}
      >
        <span />
      </Form>
      {!verified && (
        <Form
          operation="account.verification"
          label="Send verification email"
          submit={async () => {
            const result = await api<{ message: string }>(
              `/api/platform/users/${encodeURIComponent(id)}/verification`,
              { method: "POST", body: {} },
            );
            setMessage(result.message);
          }}
        >
          <span />
        </Form>
      )}
      {id.startsWith("auth0|") && (
        <Form
          operation="account.verification"
          label="Send password reset email"
          submit={async () => {
            const result = await api<{ message: string }>(
              `/api/platform/users/${encodeURIComponent(id)}/password-reset`,
              { method: "POST", body: {} },
            );
            setMessage(result.message);
          }}
        >
          <span />
        </Form>
      )}
      <ManualPassword id={id} platform active={active}/>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
