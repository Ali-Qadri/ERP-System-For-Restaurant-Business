export const DEFAULT_APP_NAME = "ERP Business System";

function brandInitials(name) {
  const words = String(name || DEFAULT_APP_NAME).trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "E";
}

export function setApplicationBranding(restaurantName = "") {
  const name = String(restaurantName || "").trim() || DEFAULT_APP_NAME;
  document.title = name === DEFAULT_APP_NAME ? DEFAULT_APP_NAME : `${name} | ${DEFAULT_APP_NAME}`;
  document.querySelectorAll("[data-brand-name]").forEach((element) => { element.textContent = name; });
  document.querySelectorAll("[data-brand-mark]").forEach((element) => { element.textContent = brandInitials(name); });
  document.querySelectorAll("[data-brand-home]").forEach((element) => { element.setAttribute("aria-label", `${name} home`); });
}
