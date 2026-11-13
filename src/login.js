import { startDashboard } from "../app.js";
import { startSuperAdminDashboard } from "./superAdminDashboard.js";
import { getCurrentAuthContext, signIn, signOut } from "./lib/auth.js";
import { isSupabaseConfigured, requireSupabase, supabase } from "./lib/supabaseClient.js";

const loginScreen = document.getElementById("login-screen");
const forgotScreen = document.getElementById("forgot-password-screen");
const resetScreen = document.getElementById("reset-password-screen");
const dashboard = document.querySelector(".app-shell");
const superAdminRoot = document.getElementById("super-admin-root");
const form = document.getElementById("login-form");
const forgotForm = document.getElementById("forgot-password-form");
const resetForm = document.getElementById("reset-password-form");
const errorBox = document.getElementById("login-error");
const forgotMessage = document.getElementById("forgot-password-message");
const resetMessage = document.getElementById("reset-password-message");
const RECOVERY_REDIRECT_URL = "https://erp-system-for-restaurant-business.vercel.app/";
let dashboardStarted = false;
let recoverySessionAvailable = false;

function isRecoveryUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
}

function hideAuthScreens() {
  loginScreen.hidden = true;
  forgotScreen.hidden = true;
  resetScreen.hidden = true;
}

function showLogin(message = "") {
  hideAuthScreens();
  loginScreen.hidden = false;
  dashboard.hidden = true;
  superAdminRoot.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function showForgot(message = "", isSuccess = false) {
  hideAuthScreens();
  dashboard.hidden = true;
  superAdminRoot.hidden = true;
  forgotScreen.hidden = false;
  forgotMessage.className = `login-message ${isSuccess ? "login-success" : "login-error"}`;
  forgotMessage.textContent = message;
  forgotMessage.hidden = !message;
}

function showReset(message = "", canUpdate = recoverySessionAvailable) {
  hideAuthScreens();
  dashboard.hidden = true;
  superAdminRoot.hidden = true;
  resetScreen.hidden = false;
  resetForm.hidden = !canUpdate;
  resetMessage.className = `login-message ${canUpdate ? "login-error" : "login-error"}`;
  resetMessage.textContent = message;
  resetMessage.hidden = !message;
}

async function showDashboard(context) {
  if (dashboardStarted) return;
  dashboardStarted = true;
  loginScreen.hidden = true;
  if (context.accountType === "platform_admin") {
    dashboard.hidden = true;
    superAdminRoot.hidden = false;
    await startSuperAdminDashboard(context);
    return;
  }
  superAdminRoot.hidden = true;
  dashboard.hidden = false;
  await startDashboard(context);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Signing in…";
  try {
    const data = new FormData(form);
    await showDashboard(await signIn(String(data.get("email")).trim(), String(data.get("password"))));
  } catch (error) {
    showLogin(error.message || "We could not sign you in right now.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = forgotForm.querySelector("button[type=submit]");
  const email = String(new FormData(forgotForm).get("email") || "").trim();
  forgotMessage.hidden = true;
  submit.disabled = true;
  submit.textContent = "Sending…";
  try {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: RECOVERY_REDIRECT_URL
    });
    if (error) throw error;
    showForgot("If an account exists for that email, a secure recovery link has been sent.", true);
  } catch (error) {
    showForgot(error.message || "We could not send a recovery link right now.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Send recovery link";
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(resetForm);
  const password = String(data.get("password") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");
  const submit = resetForm.querySelector("button[type=submit]");
  resetMessage.hidden = true;
  if (password.length < 8) {
    showReset("Your new password must be at least 8 characters.");
    return;
  }
  if (password !== confirmPassword) {
    showReset("The passwords do not match.");
    return;
  }
  submit.disabled = true;
  submit.textContent = "Updating…";
  try {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
    await signOut();
    recoverySessionAvailable = false;
    showLogin("Your password has been updated. You can now sign in.");
  } catch (error) {
    showReset(error.message || "We could not update your password. The recovery link may have expired.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Update password";
  }
});

document.addEventListener("click", async (event) => {
  const authViewButton = event.target.closest("[data-auth-view]");
  if (authViewButton) {
    if (authViewButton.dataset.authView === "forgot") showForgot();
    else showLogin();
    return;
  }
  const button = event.target.closest('[data-action="logout"]');
  if (!button) return;
  button.disabled = true;
  try {
    await signOut();
    window.location.reload();
  } catch (error) {
    button.disabled = false;
    showLogin(error.message);
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      recoverySessionAvailable = Boolean(session);
      showReset(session ? "" : "This recovery link is invalid or expired. Request a new link to continue.", Boolean(session));
      return;
    }
    if (event === "SIGNED_OUT") {
      dashboardStarted = false;
      showLogin();
    }
  });
}

if (!isSupabaseConfigured) {
  showLogin("Supabase is not configured. Add your project URL and anon key to .env.local.");
} else {
  requireSupabase().auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      if (isRecoveryUrl()) {
        recoverySessionAvailable = Boolean(data.session);
        showReset(data.session ? "" : "This recovery link is invalid or expired. Request a new link to continue.", Boolean(data.session));
        return;
      }
      return data.session
        ? getCurrentAuthContext().then((context) => context ? showDashboard(context) : showLogin())
        : showLogin();
    })
    .catch((error) => showLogin(error.message || "Your session could not be restored. Please sign in again."));
}
