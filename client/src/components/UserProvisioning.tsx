import { useState } from "react";
import { api } from "../api";
import { Form } from "../pages/Workspace";
export function UserProvisioning({ saved }: { saved: (id?: string) => void }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <section className="panel">
      <h2>Create a sign-in account</h2>
      <p>
        Create an email/password identity, then assign its company and role
        below. Use Send password setup email from its profile so the user
        chooses their password. Creating an account does not send email
        automatically.
      </p>
      <Form
        key={key}
        operation="user.provision"
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
        <label>
          New user name
          <input name="name" required maxLength={200} />
        </label>
        <label>
          New user email
          <input name="email" type="email" required maxLength={254} />
        </label>
        <p className="help">
          Retry with the same details if the response is lost. Existing
          email/password accounts are reused without changing their password.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => setKey(crypto.randomUUID())}
        >
          Start another account
        </button>
      </Form>
    </section>
  );
}
export function UserVerificationControls({
  id,
  verified,
  saved,
}: {
  id: string;
  verified?: boolean;
  saved: () => void;
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
          label="Send password setup email"
          submit={async () => {
            const result = await api<{ message: string }>(
              `/api/platform/users/${encodeURIComponent(id)}/password-setup`,
              { method: "POST", body: {} },
            );
            setMessage(result.message);
          }}
        >
          <span />
        </Form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
