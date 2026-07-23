import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle,
  EnvelopeSimple,
  LockKey,
  SignOut,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";

function getFriendlyAuthError(error) {
  const message = error?.message || "Something went wrong. Please try again.";

  if (message.toLowerCase().includes("invalid login credentials")) {
    return "That email and password combination was not recognized.";
  }

  if (message.toLowerCase().includes("email not confirmed")) {
    return "Confirm your email first, then come back to sign in.";
  }

  return message;
}

export function AuthDialog({
  open,
  onOpenChange,
  session,
  sessionLoading,
}) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setNotice(null);
    }
  }, [open]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase || submitting) return;

    setSubmitting(true);
    setNotice(null);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) throw error;

        if (data.session) {
          setNotice({
            type: "success",
            text: "Account created. You’re signed in.",
          });
        } else {
          setNotice({
            type: "success",
            text: "Check your inbox to confirm your email, then sign in.",
          });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;
        onOpenChange(false);
      }
    } catch (error) {
      setNotice({ type: "error", text: getFriendlyAuthError(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase || submitting) return;

    setSubmitting(true);
    setNotice(null);
    const { error } = await supabase.auth.signOut();
    setSubmitting(false);

    if (error) {
      setNotice({ type: "error", text: getFriendlyAuthError(error) });
      return;
    }

    onOpenChange(false);
  };

  const emailAddress = session?.user?.email || "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content auth-dialog">
          <div className="dialog-heading auth-heading">
            <div>
              <span className="eyebrow">
                {session ? "Your Findr account" : "Save your place"}
              </span>
              <Dialog.Title>
                {session ? "Account" : "Sign in to Findr"}
              </Dialog.Title>
              <Dialog.Description>
                {session
                  ? "Your session is secured by Supabase Auth."
                  : "Create an account or return to one you already use."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="icon-button"
                type="button"
                aria-label="Close account"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {!isSupabaseConfigured ? (
            <div className="auth-setup-state" role="status">
              <span className="auth-status-icon">
                <LockKey size={24} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <h3>Account service is ready to connect</h3>
                <p>
                  Add the Supabase project URL and publishable key to activate
                  real account creation and sign-in.
                </p>
              </div>
            </div>
          ) : sessionLoading ? (
            <div className="auth-loading" role="status">
              Checking your session…
            </div>
          ) : session ? (
            <div className="account-summary">
              <span className="account-avatar" aria-hidden="true">
                {emailAddress.slice(0, 1).toUpperCase() || "F"}
              </span>
              <div>
                <span>Signed in as</span>
                <strong>{emailAddress}</strong>
              </div>
              <div className="account-status">
                <CheckCircle size={18} weight="fill" aria-hidden="true" />
                Active session
              </div>
              <p>
                Saved-event syncing is not connected yet; this demo still keeps
                saves on this device.
              </p>
              <button
                className="button secondary auth-submit"
                type="button"
                onClick={handleSignOut}
                disabled={submitting}
              >
                <SignOut size={19} aria-hidden="true" />
                {submitting ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : (
            <>
              <div className="auth-tabs" aria-label="Account action">
                <button
                  type="button"
                  className={mode === "signin" ? "selected" : ""}
                  aria-pressed={mode === "signin"}
                  onClick={() => {
                    setMode("signin");
                    setNotice(null);
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={mode === "signup" ? "selected" : ""}
                  aria-pressed={mode === "signup"}
                  onClick={() => {
                    setMode("signup");
                    setNotice(null);
                  }}
                >
                  Create account
                </button>
              </div>

              <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                  <span>Email address</span>
                  <div className="auth-input">
                    <EnvelopeSimple size={20} aria-hidden="true" />
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </label>

                <label>
                  <span>Password</span>
                  <div className="auth-input">
                    <LockKey size={20} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        mode === "signup"
                          ? "At least 8 characters"
                          : "Your password"
                      }
                      minLength={8}
                      required
                    />
                  </div>
                </label>

                {notice ? (
                  <div
                    className={`auth-notice ${notice.type}`}
                    role={notice.type === "error" ? "alert" : "status"}
                  >
                    {notice.type === "error" ? (
                      <WarningCircle size={19} weight="bold" aria-hidden="true" />
                    ) : (
                      <CheckCircle size={19} weight="fill" aria-hidden="true" />
                    )}
                    <span>{notice.text}</span>
                  </div>
                ) : null}

                <button
                  className="button primary auth-submit"
                  type="submit"
                  disabled={submitting}
                >
                  <UserCircle size={20} weight="bold" aria-hidden="true" />
                  {submitting
                    ? "Please wait…"
                    : mode === "signup"
                      ? "Create account"
                      : "Sign in"}
                </button>

                <p className="auth-privacy">
                  Passwords are handled by Supabase Auth and are never stored in
                  this frontend.
                </p>
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
