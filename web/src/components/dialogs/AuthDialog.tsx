"use client";

/**
 * Log in, or create an account as a student or a teacher. Opened with openAuth()
 * (state/dialogs.ts), which resolves once the user is logged in or gives up.
 */
import { useState, type FormEvent } from "react";
import { useStore } from "@/hooks/useStore";
import { MIN_PASSWORD } from "@/lib/credentials";
import { api, type Role } from "@/services/api";
import { authStore } from "@/state/dialogs";
import { toast } from "@/state/toast";
import { Modal } from "./Modal";

type Tab = "login" | "register";

export function AuthDialog() {
  const request = useStore(authStore, null);
  const [tab, setTab] = useState<Tab>("login");
  const [role, setRole] = useState<Role>("student");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shownRequest, setShownRequest] = useState(request);

  // A new request starts with an empty form (the tab and role stay as they were)
  if (request !== shownRequest) {
    setShownRequest(request);
    if (request) {
      setUsername("");
      setPassword("");
      setError("");
    }
  }

  const close = () => {
    if (!request) return;
    authStore.set(null);
    request.resolve(!!api.currentUser());
  };

  const chooseTab = (t: Tab) => {
    setTab(t);
    setError("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = username.trim();
      const notice = await (tab === "login" ? api.login(name, password) : api.register(name, password, role));
      const user = api.currentUser()?.username ?? name;
      close();
      toast(
        notice || (tab === "login" ? `Welcome back, ${user}` : `Account created. Hi, ${user}!`),
        notice ? "error" : "ok",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!request} onClose={close} label="Your account">
      <form onSubmit={submit}>
        <h2>Your account</h2>
        {request?.reason ? <p className="muted">{request.reason}</p> : null}
        <p className="muted">Your account and melodies are kept on the classroom board and in the cloud.</p>
        <div className="seg">
          <button type="button" aria-pressed={tab === "login"} onClick={() => chooseTab("login")}>
            Log in
          </button>
          <button type="button" aria-pressed={tab === "register"} onClick={() => chooseTab("register")}>
            Create account
          </button>
        </div>
        {tab === "register" ? (
          <div className="seg role">
            <button type="button" aria-pressed={role === "student"} onClick={() => setRole("student")}>
              I&apos;m a student
            </button>
            <button type="button" aria-pressed={role === "teacher"} onClick={() => setRole("teacher")}>
              I&apos;m a teacher
            </button>
          </div>
        ) : null}
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="err" role="alert">
          {error}
        </p>
        <div className="row">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {tab === "login" ? "Log in" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
