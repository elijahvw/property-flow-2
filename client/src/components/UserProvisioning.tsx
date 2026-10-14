import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Form } from "../pages/Workspace";
type Remote = {
  user_id: string;
  email: string;
  email_verified: boolean;
  name?: string;
  blocked?: boolean;
};
type Directory = { users: Remote[]; nextPage: number | null };
export function UserProvisioning({ saved }: { saved: (id?: string) => void }) {
  const sequence = useRef(0);
  const [directory, setDirectory] = useState<Directory | null>(null),
    [email, setEmail] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load(page = 0) {
    const revision = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<Directory>(
        `/api/platform/identity-users?${new URLSearchParams({ page: String(page), ...(email ? { email } : {}) })}`,
      );
      if (revision === sequence.current) setDirectory(result);
    } catch (e) {
      if (revision === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "Unable to load the sign-in directory.",
        );
    } finally {
      if (revision === sequence.current) setBusy(false);
    }
  }
  async function add(ids: string[]) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ items: { id: string }[] }>(
        "/api/platform/identity-users/import",
        { method: "POST", body: { userIds: ids } },
      );
      saved(result.items.length === 1 ? result.items[0].id : undefined);
      setMessage(
        "Accounts added or refreshed. You can assign their company and role before they sign in.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add accounts.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, []);
  return (
    <>
      <section className="panel">
        <h2>Auth0 sign-in directory</h2>
        <p>
          Add users imported into Auth0 without asking them to sign in first.
          Adding an existing account preserves its company, role and disabled
          status.
        </p>
        <label>
          Exact email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => void load()}>
          Search or refresh Auth0 accounts
        </button>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {directory && (
          <>
            <p>
              {directory.users.length} accounts on this directory page. Search
              an exact email if an account is missing.
            </p>
            <button
              disabled={busy || !directory.users.length}
              onClick={() => void add(directory.users.map((u) => u.user_id))}
            >
              Add all accounts on this page
            </button>
            <ul className="record-list">
              {directory.users.map((u) => (
                <li key={u.user_id}>
                  <strong>{u.name || u.email}</strong>
                  <p>
                    {u.email} ·{" "}
                    {u.email_verified ? "Email verified" : "Email not verified"}
                    {u.blocked ? " · Sign-in blocked" : ""}
                  </p>
                  <button disabled={busy} onClick={() => void add([u.user_id])}>
                    Add or refresh {u.email}
                  </button>
                </li>
              ))}
            </ul>
            {directory.nextPage !== null && (
              <button
                disabled={busy}
                onClick={() => void load(directory.nextPage!)}
              >
                Next directory page
              </button>
            )}
          </>
        )}
      </section>
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
    </>
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
