import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Form } from "../pages/Workspace";
export function EmailVerification() {
  const { user, refreshUser } = useAuth(),
    [message, setMessage] = useState("");
  if (!user || user.emailVerified !== false) return null;
  return (
    <section
      className="notice"
      role="alertdialog"
      aria-labelledby="verify-email-title"
      aria-describedby="verify-email-description"
    >
      <h2 id="verify-email-title">Verify your email</h2>
      <p id="verify-email-description">
        Your administrator can set up your access now. Verify {user.email}{" "}
        before opening your assigned workspace. Check your inbox and spam
        folder.
      </p>
      <Form
        operation="account.verification"
        label="Send verification email"
        submit={async () => {
          const result = await api<{ message: string }>(
            "/api/account/verification",
            { method: "POST", body: {} },
          );
          setMessage(result.message);
        }}
      >
        <span />
      </Form>
      <Form
        operation="account.verification"
        label="I verified my email — check status"
        submit={async () => {
          const result = await api<{ emailVerified: boolean }>(
            "/api/account/verification-status",
            { method: "POST", body: {} },
          );
          if (!result.emailVerified)
            setMessage(
              "Your email is still unverified. Open the verification link, then check again.",
            );
          await refreshUser();
        }}
      >
        <span />
      </Form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
