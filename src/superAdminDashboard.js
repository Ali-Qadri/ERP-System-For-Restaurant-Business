import { requireSupabase } from "./lib/supabaseClient.js";
import { setApplicationBranding } from "./lib/branding.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function statusClass(status) {
  return String(status || "unknown").toLowerCase().replace(/\s+/g, "-");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function startSuperAdminDashboard({ user } = {}) {
  setApplicationBranding();
  const root = document.getElementById("super-admin-root");
  const email = user?.email || "Platform administrator";

  root.innerHTML = `<div class="super-admin-shell">
    <aside class="super-admin-sidebar">
      <a class="brand" href="#" data-super-view="overview" aria-label="ERP Business System platform home">
        <span class="brand-mark" data-brand-mark>E</span>
        <span class="brand-copy"><strong data-brand-name>ERP Business System</strong><small>PLATFORM ADMINISTRATION</small></span>
      </a>
      <div class="super-admin-label">PLATFORM ADMIN</div>
      <nav class="super-admin-nav" aria-label="Platform administration">
        <button class="super-nav-item active" data-super-view="overview">◫<span>Overview</span></button>
        <button class="super-nav-item" data-super-view="restaurants">▦<span>Restaurants</span></button>
        <button class="super-nav-item" data-super-view="owners">♙<span>Owners &amp; Accounts</span></button>
        <button class="super-nav-item" data-super-view="settings">⚙<span>Settings</span></button>
      </nav>
      <div class="super-admin-sidebar-bottom">
        <div class="super-admin-user"><span class="profile-avatar">${escapeHtml(email.slice(0, 2).toUpperCase())}</span><span><strong>Super Admin</strong><small>${escapeHtml(email)}</small></span></div>
        <button class="logout-link" data-action="logout" type="button">Sign out</button>
      </div>
    </aside>
    <main class="super-admin-main">
      <header class="super-admin-topbar"><div><span class="eyebrow">PLATFORM CONTROL</span><h1 id="super-admin-title">Overview</h1></div><span class="super-admin-session">Signed in as Super Admin</span></header>
      <div id="super-admin-content" class="super-admin-content"></div>
    </main>
  </div>`;

  const content = root.querySelector("#super-admin-content");
  const title = root.querySelector("#super-admin-title");
  let slugManuallyEdited = false;
  let pageNotice = "";

  function renderOverview(restaurants = []) {
    const countByStatus = (status) => restaurants.filter((restaurant) => String(restaurant.status || "").toLowerCase() === status).length;
    const stats = [
      { label: "Total restaurants", value: restaurants.length, tone: "neutral" },
      { label: "Active restaurants", value: countByStatus("active"), tone: "green" },
      { label: "Pending restaurants", value: countByStatus("pending"), tone: "gold" },
      { label: "Suspended restaurants", value: countByStatus("suspended"), tone: "coral" }
    ];
    const recentRows = restaurants.map((restaurant) => `<tr><td><strong>${escapeHtml(restaurant.name || "Unnamed restaurant")}</strong></td><td>${escapeHtml(restaurant.slug || "—")}</td><td><span class="super-status-badge ${statusClass(restaurant.status)}">${escapeHtml(restaurant.status || "Unknown")}</span></td><td>${escapeHtml(restaurant.currency_code || "—")}</td><td>${formatDate(restaurant.created_at)}</td></tr>`).join("");
    const recentContent = restaurants.length
      ? `<div class="table-scroll"><table class="data-table super-restaurant-table"><thead><tr><th>RESTAURANT</th><th>SLUG</th><th>STATUS</th><th>CURRENCY</th><th>CREATED</th></tr></thead><tbody>${recentRows}</tbody></table></div>`
      : `<div class="super-empty-state"><span class="super-empty-icon">＋</span><strong>No restaurants yet</strong><p>Restaurant workspaces will appear here after they are added.</p></div>`;

    content.innerHTML = `<section class="super-page-heading"><div><span class="eyebrow">PLATFORM OVERVIEW</span><h2>Restaurant network</h2><p>Monitor restaurant accounts and platform activity from one workspace.</p></div></section>
      ${pageNotice ? `<div class="super-form-notice super-page-notice">${escapeHtml(pageNotice)}</div>` : ""}
      <section class="super-stat-grid">${stats.map((stat) => `<article class="super-stat-card ${stat.tone}"><span>${stat.label}</span><strong>${stat.value}</strong><small>From your restaurant network</small></article>`).join("")}</section>
      <section class="super-panel"><div class="super-panel-heading"><div><h2>Recently added restaurants</h2><p>Sorted by creation date, newest first.</p></div></div>${recentContent}</section>`;
  }

  function renderLoading() {
    content.innerHTML = `<section class="super-page-heading"><div><span class="eyebrow">PLATFORM OVERVIEW</span><h2>Restaurant network</h2><p>Loading restaurant data…</p></div></section><section class="super-panel"><div class="super-loading" role="status">Loading restaurants</div></section>`;
  }

  function renderError() {
    content.innerHTML = `<section class="super-page-heading"><div><span class="eyebrow">PLATFORM OVERVIEW</span><h2>Restaurant network</h2><p>Restaurant data could not be loaded.</p></div></section><section class="super-panel"><div class="super-error" role="alert"><strong>We couldn’t load restaurants.</strong><p>Check your connection or Supabase permissions, then try again.</p><button class="button button-outline" data-super-action="retry">Retry</button></div></section>`;
  }

  async function loadRestaurants() {
    renderLoading();
    const { data, error } = await requireSupabase()
      .from("restaurants")
      .select("name, slug, status, currency_code, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Could not load restaurants for the platform dashboard.", error);
      renderError();
      return;
    }
    renderOverview(data || []);
  }

  function renderRestaurantsPage() {
    title.textContent = "Restaurants";
    content.innerHTML = `<section class="super-page-heading super-page-heading-actions"><div><span class="eyebrow">PLATFORM ADMIN</span><h2>Restaurants</h2><p>View and prepare restaurant workspaces for onboarding.</p></div><button class="button button-primary" data-super-action="open-create-restaurant">＋ Create Restaurant</button></section><section class="super-panel"><div class="super-panel-heading"><div><h2>Restaurant workspaces</h2><p>Creation is currently frontend-only and will be connected in the next step.</p></div></div><div class="super-empty-state"><span class="super-empty-icon">＋</span><strong>Ready to add a restaurant</strong><p>Start by entering the restaurant and owner details.</p><button class="button button-outline" data-super-action="open-create-restaurant">Create Restaurant</button></div></section>`;
  }

  function openCreateRestaurantForm() {
    slugManuallyEdited = false;
    root.insertAdjacentHTML("beforeend", `<div class="super-modal-backdrop"><section class="super-modal" role="dialog" aria-modal="true" aria-labelledby="create-restaurant-title"><header class="super-modal-header"><div><span class="eyebrow">NEW WORKSPACE</span><h2 id="create-restaurant-title">Create Restaurant</h2><p>Enter the workspace and owner details to prepare onboarding.</p></div><button class="modal-close" data-super-action="close-create-restaurant" aria-label="Close dialog">×</button></header><form id="create-restaurant-form" class="super-modal-body" novalidate><div class="super-form-section"><div class="super-form-section-heading"><h3>Restaurant Details</h3><span>All fields are required</span></div><div class="form-grid"><label class="form-field"><span>Restaurant Name <i>*</i></span><input name="restaurantName" type="text" autocomplete="organization" required><small class="super-field-error" data-field-error="restaurantName"></small></label><label class="form-field"><span>URL Slug <i>*</i></span><input name="slug" type="text" autocomplete="off" required><small class="super-field-help">Lowercase letters, numbers, and hyphens.</small><small class="super-field-error" data-field-error="slug"></small></label><label class="form-field"><span>Currency <i>*</i></span><select name="currency" required><option value="PKR" selected>PKR — Pakistani Rupee</option><option value="USD">USD — US Dollar</option><option value="AED">AED — UAE Dirham</option></select><small class="super-field-error" data-field-error="currency"></small></label><label class="form-field"><span>Timezone <i>*</i></span><select name="timezone" required><option value="Asia/Karachi" selected>Asia/Karachi</option><option value="Asia/Dubai">Asia/Dubai</option><option value="UTC">UTC</option></select><small class="super-field-error" data-field-error="timezone"></small></label></div></div><div class="super-form-section"><div class="super-form-section-heading"><h3>Restaurant Owner Details</h3><span>Login access will be connected later</span></div><div class="form-grid"><label class="form-field"><span>Owner Full Name <i>*</i></span><input name="ownerName" type="text" autocomplete="name" required><small class="super-field-error" data-field-error="ownerName"></small></label><label class="form-field"><span>Owner Email Address <i>*</i></span><input name="ownerEmail" type="email" autocomplete="email" required><small class="super-field-error" data-field-error="ownerEmail"></small></label></div></div><div class="super-form-notice" data-form-notice hidden></div><footer class="super-modal-footer"><button class="button button-outline" type="button" data-super-action="close-create-restaurant">Cancel</button><button class="button button-primary" type="submit">Create Restaurant</button></footer></form></section></div>`);
  }

  function validateCreateRestaurantForm(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const errors = {};
    if (!values.restaurantName.trim()) errors.restaurantName = "Restaurant name is required.";
    if (!values.slug.trim()) errors.slug = "URL slug is required.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug.trim())) errors.slug = "Use lowercase letters, numbers, and single hyphens.";
    if (!values.currency) errors.currency = "Currency is required.";
    if (!values.timezone) errors.timezone = "Timezone is required.";
    if (!values.ownerName.trim()) errors.ownerName = "Owner name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ownerEmail.trim())) errors.ownerEmail = "Enter a valid email address.";
    form.querySelectorAll("[data-field-error]").forEach((element) => { element.textContent = errors[element.dataset.fieldError] || ""; });
    return errors;
  }

  async function getFunctionError(error) {
    if (error?.context) {
      try {
        const payload = await error.context.json();
        if (payload?.error) return payload.error;
      } catch {
        // Fall back to the SDK error message below.
      }
    }
    return error?.message || "Restaurant creation failed. Please try again.";
  }

  async function createRestaurant(form) {
    const errors = validateCreateRestaurantForm(form);
    const notice = form.querySelector("[data-form-notice]");
    const submit = form.querySelector("button[type=submit]");
    if (Object.keys(errors).length) {
      notice.hidden = true;
      return;
    }

    const values = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    submit.textContent = "Creating…";
    notice.className = "super-form-notice";
    notice.textContent = "Creating the restaurant and sending the owner invitation…";
    notice.hidden = false;
    try {
      const { data, error } = await requireSupabase().functions.invoke("create-restaurant", {
        body: {
          name: values.restaurantName.trim(),
          slug: values.slug.trim(),
          currency_code: values.currency,
          timezone: values.timezone,
          owner_full_name: values.ownerName.trim(),
          owner_email: values.ownerEmail.trim()
        }
      });
      if (error) throw new Error(await getFunctionError(error));
      if (!data?.success) throw new Error(data?.error || "Restaurant creation failed. Please try again.");
      pageNotice = "Restaurant created and the owner invitation was sent.";
      root.querySelector(".super-modal-backdrop")?.remove();
      await loadRestaurants();
    } catch (error) {
      notice.className = "super-form-notice super-form-notice-error";
      notice.textContent = error.message || "Restaurant creation failed. Please try again.";
      notice.hidden = false;
      submit.disabled = false;
      submit.textContent = "Create Restaurant";
    }
  }

  function renderPlaceholder(view) {
    const labels = { restaurants: "Restaurants", owners: "Owners & Accounts", settings: "Settings" };
    title.textContent = labels[view];
    content.innerHTML = `<section class="super-page-heading"><div><span class="eyebrow">PLATFORM ADMIN</span><h2>${labels[view]}</h2><p>This area is reserved for the next onboarding step.</p></div></section><section class="super-panel"><div class="super-empty-state"><span class="super-empty-icon">✦</span><strong>${labels[view]} management is not connected yet</strong><p>No records are created or changed in this phase.</p></div></section>`;
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-super-action]");
    if (action?.dataset.superAction === "open-create-restaurant") {
      openCreateRestaurantForm();
      return;
    }
    if (action?.dataset.superAction === "close-create-restaurant") {
      root.querySelector(".super-modal-backdrop")?.remove();
      return;
    }
    if (event.target.classList.contains("super-modal-backdrop")) {
      event.target.remove();
      return;
    }
    if (action?.dataset.superAction === "retry") {
      await loadRestaurants();
      return;
    }
    const item = event.target.closest("[data-super-view]");
    if (!item) return;
    event.preventDefault();
    const view = item.dataset.superView;
    root.querySelectorAll(".super-nav-item").forEach((button) => button.classList.toggle("active", button.dataset.superView === view));
    title.textContent = view === "overview" ? "Overview" : item.textContent.trim();
    if (view === "overview") await loadRestaurants();
    else if (view === "restaurants") renderRestaurantsPage();
    else renderPlaceholder(view);
  });

  root.addEventListener("input", (event) => {
    const form = event.target.closest("#create-restaurant-form");
    if (!form) return;
    if (event.target.name === "slug") slugManuallyEdited = true;
    if (event.target.name === "restaurantName" && !slugManuallyEdited) form.elements.slug.value = slugify(event.target.value);
  });

  root.addEventListener("submit", async (event) => {
    if (event.target.id !== "create-restaurant-form") return;
    event.preventDefault();
    await createRestaurant(event.target);
  });

  await loadRestaurants();
}
