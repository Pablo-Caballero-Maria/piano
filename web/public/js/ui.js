// Small UI pieces: toasts, a confirm dialog (instead of window.confirm), the login dialog.
import * as api from "./api.js";

const $ = (id) => document.getElementById(id);

/** Markup for an icon from the SVG sprite in index.html. */
export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

let toastTimer = 0;
/** Show a short message at the bottom of the screen (kind: "ok" | "error"). */
export function toast(msg, kind = "ok") {
  const t = $("toast");
  t.textContent = msg;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 4500 : 2200);
}

/** Ask a yes/no question; resolves true if the user picks okLabel. */
export function confirmDialog(message, okLabel = "OK") {
  const d = $("confirmDlg");
  $("confirmMsg").textContent = message;
  $("confirmOk").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}

// ---- Login / create account ------------------------------------------------
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  for (const b of document.querySelectorAll("#authDlg [data-tab]")) b.setAttribute("aria-pressed", b.dataset.tab === mode);
  $("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authErr").textContent = "";
}

/** Open the login dialog; resolves true once the user is logged in, false if cancelled. */
export function openAuth(reason = "") {
  const d = $("authDlg");
  $("authReason").textContent = reason;
  $("authReason").hidden = !reason;
  setAuthMode(authMode);
  $("authForm").reset();
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(!!api.currentUser()), { once: true }));
}

/** Wire up the login dialog (once, on page load). */
export function initAuthDialog() {
  for (const b of document.querySelectorAll("#authDlg [data-tab]")) b.onclick = () => setAuthMode(b.dataset.tab);
  $("authCancel").onclick = () => $("authDlg").close();
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("authUser").value.trim(), password = $("authPassword").value;
    const btn = $("authSubmit");
    btn.disabled = true;
    $("authErr").textContent = "";
    try {
      await (authMode === "login" ? api.login(username, password) : api.register(username, password));
      $("authDlg").close();
      toast(authMode === "login" ? `Welcome back, ${username}` : `Account created. Hi, ${username}!`);
    } catch (err) {
      $("authErr").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
