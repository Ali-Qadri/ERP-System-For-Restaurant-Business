import { startDashboard } from "../app.js";
import { startSuperAdminDashboard } from "./superAdminDashboard.js";
import { getCurrentAuthContext, signIn, signOut } from "./lib/auth.js";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient.js";

const loginScreen = document.getElementById("login-screen");
const dashboard = document.querySelector(".app-shell");
const superAdminRoot = document.getElementById("super-admin-root");
const form = document.getElementById("login-form");
const errorBox = document.getElementById("login-error");
let dashboardStarted = false;

function showLogin(message = "") {
  loginScreen.hidden = false;
  dashboard.hidden = true;
  superAdminRoot.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = !message;
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

document.addEventListener("click", async (event) => {
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
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      dashboardStarted = false;
      showLogin();
    }
  });
}

if (!isSupabaseConfigured) {
  showLogin("Supabase is not configured. Add your project URL and anon key to .env.local.");
} else {
  getCurrentAuthContext()
    .then((context) => context ? showDashboard(context) : showLogin())
    .catch((error) => showLogin(error.message));
}
