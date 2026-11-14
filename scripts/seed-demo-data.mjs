import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import seed from "../mockData.js";

const DEMO_RESTAURANT_ID = "a63af3ce-824a-4d7d-a959-fd4b3a8740b2";
const SEED_NAMESPACE = "2f9b9f56-7b6b-5d1b-9f3c-1a5d8e20f6c1";
const tenantId = DEMO_RESTAURANT_ID;

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(fs.readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

const fileEnv = loadEnvFile(new URL("../.env.local", import.meta.url));
const url = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running this one-time seed.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const report = {};
const unmapped = [];

function seededUuid(kind, value) {
  const hash = crypto.createHash("sha1").update(`${SEED_NAMESPACE}:${kind}:${value}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return [...hash.subarray(0, 16)].map((byte, index) => `${byte.toString(16).padStart(2, "0")}${[3, 5, 7, 9].includes(index) ? "-" : ""}`).join("");
}

function dateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateWithOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return dateOnly(date);
}

function timeToIso(date, timeText) {
  const match = String(timeText || "12:00 PM").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return new Date(`${date}T12:00:00`).toISOString();
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${match[2]}:00`).toISOString();
}

function timeOnly(value) {
  const match = String(value || "12:00 PM").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "12:00:00";
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

function orderType(value) {
  return { "Dine in": "dine_in", Takeaway: "takeaway", Delivery: "delivery" }[value] || "dine_in";
}

function orderStatus(value) {
  return { Preparing: "preparing", Cooking: "preparing", Ready: "ready", Completed: "completed", Cancelled: "cancelled" }[value] || "pending";
}

function reservationStatus(value) {
  return { Confirmed: "confirmed", Seated: "seated", Cancelled: "cancelled" }[value] || "pending";
}

function requestStatus(value) {
  return String(value || "pending").toLowerCase();
}

function record(table, inserted, skipped, updated = 0) {
  report[table] = { inserted, skipped, updated };
}

async function existingIds(table, ids) {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from(table).select("id").in("id", ids);
  if (error) throw new Error(`${table}: could not check existing seed records: ${error.message}`);
  return new Set((data || []).map((row) => row.id));
}

async function insertDeterministic(table, rows) {
  const ids = rows.map((row) => row.id);
  const existing = await existingIds(table, ids);
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  record(table, rows.length - existing.size, existing.size);
}

async function loadRestaurant() {
  const { data, error } = await supabase.from("restaurants").select("id, name, currency_code, timezone").eq("id", tenantId).single();
  if (error || !data) throw new Error(`Demo Restaurant ${tenantId} was not found or is not accessible: ${error?.message || "unknown error"}`);
  return data;
}

async function ensureCategories() {
  const names = [...new Set(seed.menu.map((item) => item.category))];
  const { data: existing, error } = await supabase.from("menu_categories").select("id, name").eq("restaurant_id", tenantId).in("name", names);
  if (error) throw new Error(`menu_categories: ${error.message}`);
  const byName = new Map((existing || []).map((row) => [row.name, row.id]));
  const missing = names.filter((name) => !byName.has(name)).map((name, index) => ({ id: seededUuid("menu-category", name), restaurant_id: tenantId, name, description: null, sort_order: index, is_active: true }));
  if (missing.length) await insertDeterministic("menu_categories", missing);
  missing.forEach((row) => byName.set(row.name, row.id));
  record("menu_categories", missing.length, existing?.length || 0);
  return byName;
}

async function ensureSuppliers() {
  const names = [...new Set(seed.inventory.map((item) => item.supplier))];
  const { data: existing, error } = await supabase.from("suppliers").select("id, name").eq("restaurant_id", tenantId).in("name", names);
  if (error) throw new Error(`suppliers: ${error.message}`);
  const byName = new Map((existing || []).map((row) => [row.name, row.id]));
  const missing = names.filter((name) => !byName.has(name)).map((name) => ({ id: seededUuid("supplier", name), restaurant_id: tenantId, name, notes: "Imported from the initial demo inventory." }));
  if (missing.length) await insertDeterministic("suppliers", missing);
  missing.forEach((row) => byName.set(row.name, row.id));
  record("suppliers", missing.length, existing?.length || 0);
  return byName;
}

async function ensureDiningTables() {
  const rows = Array.from({ length: 14 }, (_, index) => {
    const tableNumber = `Table ${String(index + 1).padStart(2, "0")}`;
    return { id: seededUuid("dining-table", tableNumber), restaurant_id: tenantId, table_number: tableNumber, capacity: 2, status: "available", location: null };
  });
  const { data: existing, error } = await supabase.from("dining_tables").select("id, table_number").eq("restaurant_id", tenantId).in("table_number", rows.map((row) => row.table_number));
  if (error) throw new Error(`dining_tables: ${error.message}`);
  const byNumber = new Map((existing || []).map((row) => [row.table_number, row.id]));
  const missing = rows.filter((row) => !byNumber.has(row.table_number));
  if (missing.length) await insertDeterministic("dining_tables", missing);
  missing.forEach((row) => byNumber.set(row.table_number, row.id));
  record("dining_tables", missing.length, existing?.length || 0);
  unmapped.push("dining tables were generated from the existing 14-table UI options; mockData.js has no dining_tables collection");
  return byNumber;
}

async function ensureOrders(rows) {
  const { data: existing, error } = await supabase.from("orders").select("id, order_number").eq("restaurant_id", tenantId).in("order_number", rows.map((row) => row.order_number));
  if (error) throw new Error(`orders: ${error.message}`);
  const byNumber = new Map((existing || []).map((row) => [row.order_number, row.id]));
  const missing = rows.filter((row) => !byNumber.has(row.order_number));
  if (missing.length) await insertDeterministic("orders", missing);
  missing.forEach((row) => byNumber.set(row.order_number, row.id));
  record("orders", missing.length, existing?.length || 0);
  return byNumber;
}

async function main() {
  const restaurant = await loadRestaurant();
  const currency = restaurant.currency_code || seed.restaurant.currency;
  const categories = await ensureCategories();
  const suppliers = await ensureSuppliers();
  const diningTables = await ensureDiningTables();

  const employees = seed.team.map((person) => ({
    id: seededUuid("employee", person.id), restaurant_id: tenantId, full_name: person.name, email: person.email || null, phone: person.phone || null,
    position: person.role, employment_type: person.employmentType || null, hourly_rate: Number(person.hourlyRate || 0), status: "active"
  }));
  await insertDeterministic("employees", employees);
  const employeeIds = new Map(employees.map((row, index) => [seed.team[index].id, row.id]));

  const shifts = seed.team.map((person) => ({
    id: seededUuid("shift", person.id), restaurant_id: tenantId, employee_id: employeeIds.get(person.id), shift_date: dateOnly(), start_time: timeOnly(person.shiftStart), end_time: timeOnly(person.shiftEnd), notes: [person.station, person.status].filter(Boolean).join(" · ") || null
  }));
  await insertDeterministic("shift_assignments", shifts);
  const shiftIds = new Map(shifts.map((row, index) => [seed.team[index].id, row.id]));

  const inventory = seed.inventory.map((item) => ({
    id: seededUuid("inventory", item.id), restaurant_id: tenantId, supplier_id: suppliers.get(item.supplier), name: item.name, unit: item.unit,
    quantity: item.stock, minimum_quantity: item.reorderAt, unit_cost: item.cost
  }));
  await insertDeterministic("inventory_items", inventory);
  const inventoryIds = new Map(inventory.map((row, index) => [seed.inventory[index].id, row.id]));

  const menu = seed.menu.map((item) => ({
    id: seededUuid("menu-item", item.id), restaurant_id: tenantId, category_id: categories.get(item.category), name: item.name, description: item.description,
    price: item.price, image_url: item.image || null, is_available: true, preparation_time_minutes: 0
  }));
  await insertDeterministic("menu_items", menu);
  const menuIds = new Map(menu.map((row, index) => [seed.menu[index].id, row.id]));

  const ingredients = seed.menu.flatMap((item) => (item.recipe || []).map((recipe, index) => ({
    id: seededUuid("menu-ingredient", `${item.id}:${index}`), restaurant_id: tenantId, menu_item_id: menuIds.get(item.id), inventory_item_id: inventoryIds.get(recipe.ingredientId), quantity_required: recipe.quantity
  })));
  await insertDeterministic("menu_item_ingredients", ingredients);

  const reservations = seed.reservations.map((booking) => ({
    id: seededUuid("reservation", booking.id), restaurant_id: tenantId, dining_table_id: diningTables.get(booking.table) || null,
    customer_name: booking.name, customer_phone: booking.phone || null, customer_email: null, party_size: booking.guests,
    reservation_at: timeToIso(dateOnly(), booking.time), status: reservationStatus(booking.status), special_requests: null, notes: null
  }));
  await insertDeterministic("reservations", reservations);
  const reservationIds = new Map(reservations.map((row, index) => [seed.reservations[index].id, row.id]));

  const orderRows = seed.orders.map((order) => ({
    id: seededUuid("order", order.id), restaurant_id: tenantId, order_number: String(order.id), dining_table_id: diningTables.get(order.table) || null,
    reservation_id: seed.reservations.find((booking) => booking.table === order.table)?.id ? reservationIds.get(seed.reservations.find((booking) => booking.table === order.table).id) : null,
    order_type: orderType(order.type), customer_name: order.customer, customer_phone: null, status: orderStatus(order.status),
    payment_status: order.payment === "Paid" ? "paid" : "unpaid", subtotal: order.total, tax_amount: 0, discount_amount: 0, total_amount: order.total,
    currency_code: currency, notes: null, created_by: null, created_at: timeToIso(order.date, order.createdAt)
  }));
  const orderNumbers = await ensureOrders(orderRows);
  const orderIds = new Map(seed.orders.map((order) => [order.id, orderNumbers.get(String(order.id))]));

  const orderItems = seed.orders.flatMap((order) => (order.items || []).map((line, index) => {
    const item = seed.menu.find((menuItem) => menuItem.id === line.menuId);
    return { id: seededUuid("order-item", `${order.id}:${index}`), restaurant_id: tenantId, order_id: orderIds.get(order.id), menu_item_id: menuIds.get(line.menuId) || null, item_name: item?.name || "Menu item", unit_price: Number(item?.price || 0), quantity: line.quantity, line_total: Number(item?.price || 0) * line.quantity, special_instructions: null };
  }));
  await insertDeterministic("order_items", orderItems);

  const payments = seed.orders.filter((order) => order.payment === "Paid").map((order) => ({
    id: seededUuid("payment", order.id), restaurant_id: tenantId, order_id: orderIds.get(order.id), amount: order.total, payment_method: null, payment_status: "completed"
  }));
  await insertDeterministic("payments", payments);

  const timeEntries = seed.team.map((person, index) => {
    const date = person.status === "On shift" ? dateOnly() : dateWithOffset(-1);
    const clockIn = timeToIso(date, person.shiftStart || "3:00 PM");
    const clockOut = person.status === "On shift" ? null : timeToIso(date, person.shiftEnd || "11:00 PM");
    return { id: seededUuid("time-entry", `${person.id}:${date}`), restaurant_id: tenantId, employee_id: employeeIds.get(person.id), clock_in: clockIn, clock_out: clockOut, notes: `Imported demo attendance record ${index + 1}.` };
  });
  await insertDeterministic("time_entries", timeEntries);

  const leaveRequests = seed.leaveRequests.map((request) => ({ id: seededUuid("leave-request", request.id), restaurant_id: tenantId, employee_id: employeeIds.get(request.employeeId), start_date: request.startDate, end_date: request.endDate, reason: request.note || null, status: requestStatus(request.status) }));
  await insertDeterministic("leave_requests", leaveRequests);

  const replacementRequests = seed.replacementRequests.map((request) => ({ id: seededUuid("replacement-request", request.id), restaurant_id: tenantId, employee_id: employeeIds.get(request.employeeId), replacement_employee_id: request.replacementId ? employeeIds.get(request.replacementId) : null, shift_assignment_id: shiftIds.get(request.employeeId) || null, reason: request.reason || null, status: requestStatus(request.status) }));
  await insertDeterministic("replacement_requests", replacementRequests);

  const wagePayments = seed.wagePayments.map((payment) => ({ id: seededUuid("wage-payment", payment.id), restaurant_id: tenantId, employee_id: employeeIds.get(payment.employeeId), amount: payment.amount, payment_date: payment.paidDate, notes: `Period: ${payment.period}; status: ${payment.status}; method: ${payment.method}` }));
  await insertDeterministic("wage_payments", wagePayments);

  const expenses = seed.expenses.map((expense) => ({ id: seededUuid("expense", expense.id), restaurant_id: tenantId, description: `${expense.vendor}: ${expense.description}`, category: expense.category, amount: expense.amount, expense_date: expense.date, notes: `Status: ${expense.status}; payment method: ${expense.paymentMethod}` }));
  await insertDeterministic("expenses", expenses);

  const complaints = seed.complaints.map((complaint) => ({ id: seededUuid("complaint", complaint.id), restaurant_id: tenantId, employee_id: employeeIds.get(complaint.employeeId) || null, subject: complaint.subject, description: `[${complaint.category}; ${complaint.severity}] ${complaint.details}`, status: requestStatus(complaint.status), created_at: timeToIso(complaint.date, complaint.submittedAt === "Yesterday" ? "12:00 PM" : complaint.submittedAt) }));
  await insertDeterministic("complaints", complaints);

  const settings = { location: seed.restaurant.location, imported_currency: seed.restaurant.currency, source: "initial demo seed" };
  const { data: existingSettings, error: settingsError } = await supabase.from("restaurant_settings").select("id").eq("restaurant_id", tenantId).maybeSingle();
  if (settingsError) throw new Error(`restaurant_settings: ${settingsError.message}`);
  if (existingSettings) record("restaurant_settings", 0, 1);
  else await insertDeterministic("restaurant_settings", [{ id: seededUuid("restaurant-settings", tenantId), restaurant_id: tenantId, settings }]);

  unmapped.push("restaurant.name ('Juniper Table') was not written because the required destination restaurant already exists and must not be overwritten");
  unmapped.push("menu.popular, menu item preparation times, employee initials/colors, complaint submittedAt/category/severity, wage period/method/status, expense vendor/status/paymentMethod, and order stockApplied have no dedicated columns; supported values were preserved in existing text fields where safe or reported here");
  unmapped.push("sales and salesLabels are presentation-only chart fixtures; reports must be derived from orders/order_items instead");
  unmapped.push("notifications has no mock collection; no notification rows were seeded");
  unmapped.push("inventory_movements has no historical mock collection; current inventory quantities were seeded as inventory_items only");
  console.log(JSON.stringify({ destination: tenantId, restaurant: { id: restaurant.id, name: restaurant.name }, report, unmapped }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
