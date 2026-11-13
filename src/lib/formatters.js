export const clone = (value) => JSON.parse(JSON.stringify(value));

export const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
}).format(Number(value) || 0);

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

export const initials = (name) => String(name || "")
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0))
  .join("")
  .toUpperCase();

export const timeNow = () => new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
}).format(new Date());
