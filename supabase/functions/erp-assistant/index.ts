import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedRoles = new Set(["owner", "manager", "staff_shared"]);
const geminiModel = "gemini-3.5-flash-lite";
const maxMessages = 12;
const maxMessageLength = 2000;
const maxConversationLength = 12000;
const maxRequestBodyLength = 14000;
const geminiTimeoutMs = 45000;
const corsOrigin = Deno.env.get("APP_URL")?.trim() || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": corsOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

function json(body: Record<string, unknown>, status = 200) {
  console.info("ERP Assistant HTTP response sent to frontend.", { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error.";
}

function sanitizeGoogleError(payload: unknown) {
  if (!payload || typeof payload !== "object") return { message: String(payload || "No error body returned.").slice(0, 2000) };
  const source = payload as { error?: { code?: unknown; status?: unknown; message?: unknown; details?: unknown }; message?: unknown };
  return {
    code: source.error?.code,
    status: source.error?.status,
    message: String(source.error?.message || source.message || "No error message returned.").slice(0, 2000),
    details: Array.isArray(source.error?.details) ? source.error.details.slice(0, 5) : undefined
  };
}

async function readGoogleResponse(response: Response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { message: body.slice(0, 2000) };
  }
}

const readableTablesByRole: Record<string, Set<string>> = {
  staff_shared: new Set(["dining_tables", "menu_categories", "menu_items", "orders", "order_items", "reservations"]),
  manager: new Set(["dining_tables", "menu_categories", "menu_items", "orders", "order_items", "reservations", "employees", "inventory_items", "suppliers", "expenses", "payments"]),
  owner: new Set(["dining_tables", "menu_categories", "menu_items", "orders", "order_items", "reservations", "employees", "inventory_items", "suppliers", "expenses", "payments"])
};

const operationTables: Record<string, string[]> = {
  get_employee_count: ["employees"],
  get_menu_items: ["menu_items", "menu_categories"],
  get_unavailable_menu_items: ["menu_items", "menu_categories"],
  get_today_orders: ["orders"],
  get_order_summary: ["orders"],
  get_low_stock_items: ["inventory_items", "suppliers"],
  get_inventory_summary: ["inventory_items"],
  get_monthly_expenses: ["expenses"],
  get_reservations: ["reservations"],
  get_dashboard_summary: ["orders", "reservations"]
};

const writeRoles: Record<string, Set<string>> = {
  create_menu_item: new Set(["owner", "manager"]),
  create_reservation: new Set(["owner", "manager", "staff_shared"]),
  create_order: new Set(["owner", "manager", "staff_shared"])
};

const consumedConfirmationTokens = new Set<string>();

const toolDeclarations = [
  ["get_employee_count", "Get the number of employees in the active restaurant."] ,
  ["get_menu_items", "Get active restaurant menu items and their categories."] ,
  ["get_unavailable_menu_items", "Get menu items currently marked unavailable."] ,
  ["get_today_orders", "Get today's restaurant orders."] ,
  ["get_order_summary", "Summarize today's order count, statuses, and totals."] ,
  ["get_low_stock_items", "Get inventory items at or below their minimum quantity."] ,
  ["get_inventory_summary", "Summarize inventory quantities and low-stock count."] ,
  ["get_monthly_expenses", "Summarize expenses for the current calendar month."] ,
  ["get_reservations", "Get today's and upcoming restaurant reservations."] ,
  ["get_dashboard_summary", "Summarize today's available restaurant activity."],
  ["create_menu_item", "Prepare a new menu item for explicit frontend confirmation. Never save it directly.", {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      price: { type: "NUMBER" },
      categoryName: { type: "STRING" },
      description: { type: "STRING" },
      preparationTimeMinutes: { type: "INTEGER" }
    },
    required: ["name", "price", "categoryName"]
  }],
  ["create_reservation", "Prepare a new reservation for explicit frontend confirmation. Never save it directly.", {
    type: "OBJECT",
    properties: {
      customerName: { type: "STRING" },
      reservationAt: { type: "STRING" },
      partySize: { type: "INTEGER" },
      customerPhone: { type: "STRING" },
      tableNumber: { type: "STRING" },
      specialRequests: { type: "STRING" },
      notes: { type: "STRING" }
    },
    required: ["customerName", "reservationAt", "partySize"]
  }],
  ["create_order", "Prepare a new order for explicit frontend confirmation. Never save it directly.", {
    type: "OBJECT",
    properties: {
      orderType: { type: "STRING", enum: ["dine_in", "takeaway", "delivery"] },
      customerName: { type: "STRING" },
      customerPhone: { type: "STRING" },
      tableNumber: { type: "STRING" },
      notes: { type: "STRING" },
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            itemName: { type: "STRING" },
            quantity: { type: "INTEGER" }
          },
          required: ["itemName", "quantity"]
        }
      }
    },
    required: ["orderType", "items"]
  }]
].map(([name, description, parameters]) => ({
  name,
  description,
  parameters: parameters || { type: "OBJECT", properties: {} }
}));

function unavailableResult(role: string, operation: string) {
  const tables = operationTables[operation] || [];
  const readable = readableTablesByRole[role] || new Set<string>();
  const unavailable = tables.filter((table) => !readable.has(table));
  return unavailable.length
    ? { status: "unavailable", message: `Your ${role} role cannot read this dataset under the current restaurant access policies.` }
    : null;
}

function databaseFailure(table: string, error: { code?: unknown; message?: unknown; status?: unknown }) {
  console.error("ERP Assistant read query failed.", { table, code: error?.code, status: error?.status });
  return { status: "error", message: "Live data could not be loaded for this dataset." };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value);
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

async function signConfirmationPayload(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function verifyConfirmationToken(token: string, secret: string) {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signatureBytes = Uint8Array.from(base64UrlDecode(encodedSignature), (character) => character.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(encodedPayload));
  if (!valid) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { expiresAt?: unknown; userId?: unknown; restaurantId?: unknown; role?: unknown; action?: unknown; data?: unknown };
    return typeof payload.expiresAt === "number" && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function pendingResult(action: string, data: Record<string, unknown>, title: string, fields: Array<{ label: string; value: string }>) {
  return { status: "pending_confirmation", action, data, title, fields };
}

async function prepareWrite(client: ReturnType<typeof createClient>, restaurantId: string, role: string, action: string, args: unknown) {
  if (!writeRoles[action]?.has(role)) return { status: "unavailable", message: `Your ${role} role cannot perform this action under the current restaurant access policies.` };
  const input = asRecord(args);
  if (!input) return { status: "error", message: "The action arguments are invalid." };

  if (action === "create_menu_item") {
    const name = textValue(input.name);
    const categoryName = textValue(input.categoryName);
    const price = numberValue(input.price);
    const preparationTimeMinutes = input.preparationTimeMinutes === undefined ? 0 : numberValue(input.preparationTimeMinutes);
    if (!name || !categoryName || !Number.isFinite(price) || price < 0 || !Number.isInteger(preparationTimeMinutes) || preparationTimeMinutes < 0) {
      return { status: "needs_information", message: "A menu item needs a name, a non-negative price, a valid existing category, and an optional non-negative preparation time." };
    }
    const { data: categories, error } = await client.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).limit(100);
    if (error) return databaseFailure("menu_categories", error);
    const category = (categories || []).find((item) => normalizeName(item.name) === normalizeName(categoryName));
    if (!category) return { status: "needs_information", message: "I could not find that menu category. Please provide the exact name of an existing category." };
    const data = { categoryId: category.id, name, description: textValue(input.description) || null, price, preparationTimeMinutes };
    return pendingResult(action, data, "New Menu Item", [
      { label: "Name", value: name },
      { label: "Price", value: String(price) },
      { label: "Category", value: category.name },
      { label: "Preparation time", value: `${preparationTimeMinutes} minutes` }
    ]);
  }

  if (action === "create_reservation") {
    const customerName = textValue(input.customerName);
    const reservationAt = textValue(input.reservationAt);
    const partySize = numberValue(input.partySize);
    if (!customerName || !reservationAt || !Number.isInteger(partySize) || partySize <= 0 || Number.isNaN(new Date(reservationAt).getTime())) {
      return { status: "needs_information", message: "A reservation needs a guest name, a valid date and time, and a party size greater than zero." };
    }
    const tableNumber = textValue(input.tableNumber);
    let diningTableId: string | null = null;
    let resolvedTable = "To be assigned";
    if (tableNumber) {
      const { data: tables, error } = await client.from("dining_tables").select("id, table_number").eq("restaurant_id", restaurantId).eq("table_number", tableNumber).limit(1);
      if (error) return databaseFailure("dining_tables", error);
      if (!tables?.[0]) return { status: "needs_information", message: "I could not find that dining table in this restaurant. Please provide an existing table number or leave the table unassigned." };
      diningTableId = tables[0].id;
      resolvedTable = `Table ${tables[0].table_number}`;
    }
    const data = { customerName, reservationAt: new Date(reservationAt).toISOString(), partySize, customerPhone: textValue(input.customerPhone) || null, diningTableId, specialRequests: textValue(input.specialRequests) || null, notes: textValue(input.notes) || null };
    return pendingResult(action, data, "New Reservation", [
      { label: "Guest", value: customerName },
      { label: "When", value: new Date(reservationAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) },
      { label: "Party size", value: String(partySize) },
      { label: "Table", value: resolvedTable }
    ]);
  }

  if (action === "create_order") {
    const orderType = textValue(input.orderType);
    const itemsInput = Array.isArray(input.items) ? input.items : [];
    if (!(new Set(["dine_in", "takeaway", "delivery"])).has(orderType) || itemsInput.length === 0 || itemsInput.length > 20) {
      return { status: "needs_information", message: "An order needs a valid order type and at least one menu item." };
    }
    const requestedItems = itemsInput.map((item) => {
      const row = asRecord(item);
      return { itemName: textValue(row?.itemName), quantity: numberValue(row?.quantity) };
    });
    if (requestedItems.some((item) => !item.itemName || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100)) return { status: "needs_information", message: "Each order item needs an existing menu item name and a quantity greater than zero." };
    const { data: menu, error: menuError } = await client.from("menu_items").select("id, name, price, is_available").eq("restaurant_id", restaurantId).limit(200);
    if (menuError) return databaseFailure("menu_items", menuError);
    const resolvedItems = [] as Array<{ menuItemId: string; itemName: string; unitPrice: number; quantity: number; lineTotal: number }>;
    for (const item of requestedItems) {
      const matches = (menu || []).filter((menuItem) => normalizeName(menuItem.name) === normalizeName(item.itemName) && menuItem.is_available !== false);
      if (matches.length !== 1) return { status: "needs_information", message: matches.length === 0 ? `I could not find an available menu item named “${item.itemName}”.` : `More than one available menu item matches “${item.itemName}”. Please use a more specific name.` };
      const unitPrice = Number(matches[0].price);
      resolvedItems.push({ menuItemId: matches[0].id, itemName: matches[0].name, unitPrice, quantity: item.quantity, lineTotal: unitPrice * item.quantity });
    }
    const tableNumber = textValue(input.tableNumber);
    let diningTableId: string | null = null;
    let resolvedTable = "No table assigned";
    if (tableNumber) {
      const { data: tables, error } = await client.from("dining_tables").select("id, table_number").eq("restaurant_id", restaurantId).eq("table_number", tableNumber).limit(1);
      if (error) return databaseFailure("dining_tables", error);
      if (!tables?.[0]) return { status: "needs_information", message: "I could not find that dining table in this restaurant." };
      diningTableId = tables[0].id;
      resolvedTable = `Table ${tables[0].table_number}`;
    }
    const subtotal = resolvedItems.reduce((total, item) => total + item.lineTotal, 0);
    const data = { orderNumber: `AI-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, orderType, customerName: textValue(input.customerName) || null, customerPhone: textValue(input.customerPhone) || null, diningTableId, notes: textValue(input.notes) || null, items: resolvedItems, subtotal, total: subtotal };
    return pendingResult(action, data, "New Order", [
      { label: "Type", value: orderType },
      { label: "Items", value: resolvedItems.map((item) => `${item.quantity}× ${item.itemName}`).join(", ") },
      { label: "Table", value: resolvedTable },
      { label: "Total", value: String(subtotal) }
    ]);
  }
  return { status: "error", message: "This write action is not supported." };
}

async function executeWrite(client: ReturnType<typeof createClient>, userId: string, restaurantId: string, role: string, action: string, data: unknown) {
  if (!writeRoles[action]?.has(role)) return { status: "unavailable", message: `Your ${role} role cannot perform this action under the current restaurant access policies.` };
  const input = asRecord(data);
  if (!input) return { status: "error", message: "The confirmed action payload is invalid." };
  if (action === "create_menu_item") {
    if (typeof input.categoryId !== "string" || !textValue(input.name) || !Number.isFinite(numberValue(input.price)) || numberValue(input.price) < 0 || !Number.isInteger(numberValue(input.preparationTimeMinutes)) || numberValue(input.preparationTimeMinutes) < 0) return { status: "error", message: "The confirmed menu item payload is invalid." };
    const { data: category, error: categoryError } = await client.from("menu_categories").select("id").eq("restaurant_id", restaurantId).eq("id", input.categoryId).maybeSingle();
    if (categoryError || !category) return { status: "error", message: "The selected menu category is no longer available." };
    const { data: row, error } = await client.from("menu_items").insert({ restaurant_id: restaurantId, category_id: input.categoryId, name: input.name, description: input.description, price: input.price, preparation_time_minutes: input.preparationTimeMinutes, is_available: true }).select("id, name, price").single();
    return error ? { status: "error", message: "The menu item could not be created." } : { status: "success", message: `Menu item “${row.name}” was created.` };
  }
  if (action === "create_reservation") {
    if (!textValue(input.customerName) || typeof input.reservationAt !== "string" || Number.isNaN(new Date(input.reservationAt).getTime()) || !Number.isInteger(numberValue(input.partySize)) || numberValue(input.partySize) <= 0) return { status: "error", message: "The confirmed reservation payload is invalid." };
    if (input.diningTableId !== null && typeof input.diningTableId !== "string") return { status: "error", message: "The confirmed reservation table is invalid." };
    if (input.diningTableId) {
      const { data: table, error: tableError } = await client.from("dining_tables").select("id").eq("restaurant_id", restaurantId).eq("id", input.diningTableId).maybeSingle();
      if (tableError || !table) return { status: "error", message: "The selected dining table is no longer available." };
    }
    const { data: row, error } = await client.from("reservations").insert({ restaurant_id: restaurantId, dining_table_id: input.diningTableId, customer_name: input.customerName, customer_phone: input.customerPhone, party_size: input.partySize, reservation_at: input.reservationAt, status: "pending", special_requests: input.specialRequests, notes: input.notes }).select("id, customer_name").single();
    return error ? { status: "error", message: "The reservation could not be created." } : { status: "success", message: `Reservation for “${row.customer_name}” was created.` };
  }
  if (action === "create_order") {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!textValue(input.orderNumber) || !(new Set(["dine_in", "takeaway", "delivery"])).has(String(input.orderType)) || !Number.isFinite(numberValue(input.subtotal)) || numberValue(input.subtotal) < 0 || !Number.isFinite(numberValue(input.total)) || numberValue(input.total) < 0 || items.length === 0 || items.length > 20 || items.some((item) => { const row = asRecord(item); return !row || typeof row.menuItemId !== "string" || !textValue(row.itemName) || !Number.isInteger(numberValue(row.quantity)) || numberValue(row.quantity) <= 0 || !Number.isFinite(numberValue(row.unitPrice)) || numberValue(row.unitPrice) < 0 || !Number.isFinite(numberValue(row.lineTotal)) || numberValue(row.lineTotal) < 0; })) return { status: "error", message: "The confirmed order payload is invalid." };
    if (input.diningTableId !== null && typeof input.diningTableId !== "string") return { status: "error", message: "The confirmed order table is invalid." };
    if (input.diningTableId) {
      const { data: table, error: tableError } = await client.from("dining_tables").select("id").eq("restaurant_id", restaurantId).eq("id", input.diningTableId).maybeSingle();
      if (tableError || !table) return { status: "error", message: "The selected dining table is no longer available." };
    }
    const menuItemIds = items.map((item) => (item as Record<string, unknown>).menuItemId);
    const { data: menuItems, error: menuError } = await client.from("menu_items").select("id, is_available").eq("restaurant_id", restaurantId).in("id", menuItemIds);
    if (menuError || (menuItems || []).length !== new Set(menuItemIds).size || (menuItems || []).some((item) => item.is_available === false)) return { status: "error", message: "One or more selected menu items are no longer available." };
    const { data: order, error: orderError } = await client.from("orders").insert({ restaurant_id: restaurantId, order_number: input.orderNumber, dining_table_id: input.diningTableId, order_type: input.orderType, customer_name: input.customerName, customer_phone: input.customerPhone, status: "pending", payment_status: "unpaid", subtotal: input.subtotal, tax_amount: 0, discount_amount: 0, total_amount: input.total, notes: input.notes, created_by: userId }).select("id, order_number").single();
    if (orderError) return { status: "error", message: "The order could not be created." };
    const orderItems = items.map((item) => ({ restaurant_id: restaurantId, order_id: order.id, menu_item_id: item.menuItemId, item_name: item.itemName, unit_price: item.unitPrice, quantity: item.quantity, line_total: item.lineTotal }));
    const { error: itemError } = await client.from("order_items").insert(orderItems);
    if (itemError) return { status: "error", message: "The order was created but its items could not be saved. Please ask a manager to review the order." };
    return { status: "success", message: `Order #${order.order_number} was created.` };
  }
  return { status: "error", message: "This write action is not supported." };
}

function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function zonedStart(dateKey: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  let utcMillis = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMillis)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const localMillis = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utcMillis += Date.UTC(year, month - 1, day) - localMillis;
  }
  return new Date(utcMillis);
}

function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function currentDateBounds(timezone: string, month = false) {
  const now = new Date();
  const todayKey = dateKeyInTimezone(now, timezone);
  const [year, monthNumber] = todayKey.split("-").map(Number);
  const startKey = month ? `${year}-${String(monthNumber).padStart(2, "0")}-01` : todayKey;
  const nextKey = month ? new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10) : nextDateKey(todayKey);
  return { start: zonedStart(startKey, timezone).toISOString(), end: zonedStart(nextKey, timezone).toISOString(), label: startKey };
}

async function readOperation(client: ReturnType<typeof createClient>, restaurantId: string, role: string, operation: string, timezone: string) {
  const unavailable = unavailableResult(role, operation);
  if (unavailable) return unavailable;

  const today = currentDateBounds(timezone);
  const month = currentDateBounds(timezone, true);
  if (operation === "get_employee_count") {
    const { count, error } = await client.from("employees").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
    return error ? databaseFailure("employees", error) : { status: "ok", employeeCount: count || 0 };
  }
  if (operation === "get_menu_items" || operation === "get_unavailable_menu_items") {
    let query = client.from("menu_items").select("name, description, price, is_available, preparation_time_minutes, category_id").eq("restaurant_id", restaurantId).limit(100);
    if (operation === "get_unavailable_menu_items") query = query.eq("is_available", false);
    const [{ data: menu, error: menuError }, { data: categories, error: categoryError }] = await Promise.all([
      query,
      client.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).limit(100)
    ]);
    if (menuError) return databaseFailure("menu_items", menuError);
    if (categoryError) return databaseFailure("menu_categories", categoryError);
    const categoryNames = new Map((categories || []).map((category) => [category.id, category.name]));
    return { status: "ok", items: (menu || []).map((item) => ({ name: item.name, category: categoryNames.get(item.category_id) || "Uncategorized", description: item.description || "", price: item.price, available: item.is_available, preparationMinutes: item.preparation_time_minutes })) };
  }
  if (operation === "get_today_orders" || operation === "get_order_summary") {
    const { data: orders, error } = await client.from("orders").select("order_number, order_type, customer_name, status, payment_status, total_amount, currency_code, created_at").eq("restaurant_id", restaurantId).gte("created_at", today.start).lt("created_at", today.end).order("created_at", { ascending: false }).limit(100);
    if (error) return databaseFailure("orders", error);
    if (operation === "get_today_orders") return { status: "ok", date: today.label, orders: orders || [] };
    const rows = orders || [];
    const byStatus = rows.reduce((summary, order) => { const key = order.status || "unknown"; summary[key] = (summary[key] || 0) + 1; return summary; }, {} as Record<string, number>);
    return { status: "ok", date: today.label, orderCount: rows.length, totalAmount: rows.reduce((total, order) => total + Number(order.total_amount || 0), 0), byStatus, currency: rows[0]?.currency_code || null };
  }
  if (operation === "get_low_stock_items" || operation === "get_inventory_summary") {
    const [{ data: items, error: inventoryError }, { data: suppliers, error: supplierError }] = await Promise.all([
      client.from("inventory_items").select("name, unit, quantity, minimum_quantity, unit_cost, supplier_id").eq("restaurant_id", restaurantId).limit(200),
      client.from("suppliers").select("id, name").eq("restaurant_id", restaurantId).limit(200)
    ]);
    if (inventoryError) return databaseFailure("inventory_items", inventoryError);
    if (supplierError) return databaseFailure("suppliers", supplierError);
    const supplierNames = new Map((suppliers || []).map((supplier) => [supplier.id, supplier.name]));
    const rows = (items || []).map((item) => ({ name: item.name, unit: item.unit, quantity: Number(item.quantity || 0), minimumQuantity: Number(item.minimum_quantity || 0), supplier: supplierNames.get(item.supplier_id) || null }));
    const lowStock = rows.filter((item) => item.quantity <= item.minimumQuantity);
    return operation === "get_low_stock_items"
      ? { status: "ok", items: lowStock }
      : { status: "ok", itemCount: rows.length, lowStockCount: lowStock.length, totalQuantity: rows.reduce((total, item) => total + item.quantity, 0) };
  }
  if (operation === "get_monthly_expenses") {
    const { data: expenses, error } = await client.from("expenses").select("description, category, amount, expense_date").eq("restaurant_id", restaurantId).gte("expense_date", month.start.slice(0, 10)).lt("expense_date", month.end.slice(0, 10)).order("expense_date", { ascending: false }).limit(200);
    if (error) return databaseFailure("expenses", error);
    const rows = expenses || [];
    const byCategory = rows.reduce((summary, expense) => { const key = expense.category || "Uncategorized"; summary[key] = (summary[key] || 0) + Number(expense.amount || 0); return summary; }, {} as Record<string, number>);
    return { status: "ok", month: month.label, expenseCount: rows.length, totalAmount: rows.reduce((total, expense) => total + Number(expense.amount || 0), 0), byCategory };
  }
  if (operation === "get_reservations") {
    const { data: reservations, error } = await client.from("reservations").select("customer_name, party_size, reservation_at, status, notes").eq("restaurant_id", restaurantId).gte("reservation_at", today.start).order("reservation_at", { ascending: true }).limit(100);
    return error ? databaseFailure("reservations", error) : { status: "ok", reservations: reservations || [] };
  }
  if (operation === "get_dashboard_summary") {
    const [employeeResult, orderResult, inventoryResult, expenseResult, reservationResult] = await Promise.all([
      readOperation(client, restaurantId, role, "get_employee_count", timezone),
      readOperation(client, restaurantId, role, "get_order_summary", timezone),
      readOperation(client, restaurantId, role, "get_low_stock_items", timezone),
      readOperation(client, restaurantId, role, "get_monthly_expenses", timezone),
      readOperation(client, restaurantId, role, "get_reservations", timezone)
    ]);
    return { status: "ok", employees: employeeResult, orders: orderResult, inventory: inventoryResult, expenses: expenseResult, reservations: reservationResult, note: "Only datasets permitted by the current role policies are included." };
  }
  return { status: "error", message: "This data operation is not supported." };
}

function validateMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxMessages) {
    return `Send between 1 and ${maxMessages} conversation messages.`;
  }
  let totalLength = 0;
  for (const message of value) {
    if (!message || typeof message !== "object") return "Each conversation message must be an object.";
    const candidate = message as { role?: unknown; content?: unknown };
    if (!["user", "assistant"].includes(String(candidate.role))) return "Conversation roles must be user or assistant.";
    if (typeof candidate.content !== "string" || !candidate.content.trim()) return "Conversation messages cannot be empty.";
    if (candidate.content.length > maxMessageLength) return "Each conversation message is too long.";
    totalLength += candidate.content.length;
  }
  if (totalLength > maxConversationLength) return "The conversation is too long. Start a new conversation and try again.";
  if (String((value[value.length - 1] as { role?: unknown }).role) !== "user") return "The latest conversation message must be from the user.";
  return null;
}

const systemInstruction = (restaurantName: string, role: string) => `
You are ERP Assistant for ${restaurantName || "the user's restaurant"}.
The authenticated user's verified restaurant role is ${role}.

You are a help and controlled-action assistant for this restaurant ERP. Answer only questions about the application's existing features: dashboard and reports; employees; menu categories and menu items; tables and orders; reservations; inventory and suppliers; shifts and attendance; leave and replacement requests; expenses and payments; and restaurant settings.

Use simple, friendly language and clear step-by-step instructions. Tailor explanations to the verified role: owner users can manage restaurant settings, manager users can manage operational workflows, and staff_shared users should be guided only toward the sections available to staff. Do not claim that a role can access a section if the application restricts it.

When a live-data question is asked, use an approved read-only data operation when available. Explain the returned records accurately and distinguish zero results from unavailable data or a query failure. You may not infer or invent numbers.
You may prepare create_menu_item, create_reservation, or create_order only when the user clearly asks for that action and all required details are available. The server will show the user a preview; never claim that a record was saved during preparation. A record is saved only after the application sends an explicit confirmation. Ask for missing details instead of guessing.
Never invent screens, buttons, fields, reports, integrations, or data, and you must not ask for passwords, tokens, or sensitive credentials.
This assistant may create only the three explicitly supported record types after application confirmation. Never edit, delete, approve, export, or otherwise mutate ERP records. Never execute SQL, call unapproved database tools, or provide instructions to bypass authentication, role restrictions, RLS, or restaurant boundaries.
Politely redirect unrelated questions by saying you can help with the ERP topics listed above.
`.trim();

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);
  console.info("ERP Assistant request received.");

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication is required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !geminiApiKey) return json({ error: "The assistant is not configured correctly." }, 500);

  let input: { messages?: unknown; confirmationToken?: unknown; requestType?: unknown };
  try {
    const requestBody = await request.text();
    if (requestBody.length > maxRequestBodyLength) return json({ error: "The assistant request is too large." }, 413);
    const parsed = JSON.parse(requestBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Request body must be a JSON object." }, 400);
    input = parsed as typeof input;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const isConfirmation = input.requestType === "confirm";
  if (isConfirmation) {
    if (typeof input.confirmationToken !== "string" || input.confirmationToken.length > 6000) return json({ error: "The confirmation is invalid or expired." }, 400);
  } else {
    const validationError = validateMessages(input.messages);
    if (validationError) return json({ error: validationError }, 400);
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return json({ error: "Your session is invalid or expired." }, 401);
  console.info("ERP Assistant JWT verified.");

  console.info("ERP Assistant membership lookup started.");
  const { data: membership, error: membershipError } = await userClient
    .from("restaurant_members")
    .select("restaurant_id, role")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  console.info("ERP Assistant membership lookup completed.", {
    dataExists: Boolean(membership),
    errorExists: Boolean(membershipError),
    errorCode: membershipError?.code,
    errorMessage: membershipError?.message,
    errorDetails: membershipError?.details,
    errorHint: membershipError?.hint
  });
  if (membershipError) return json({ error: "Your restaurant membership could not be verified." }, 500);
  if (!membership || !allowedRoles.has(membership.role)) return json({ error: "You do not have an active restaurant role for the assistant." }, 403);
  console.info("ERP Assistant restaurant membership verified.");

  const { data: restaurant, error: restaurantError } = await userClient
    .from("restaurants")
    .select("name, timezone")
    .eq("id", membership.restaurant_id)
    .maybeSingle();
  if (restaurantError || !restaurant) return json({ error: "Your restaurant could not be verified." }, 403);

  if (isConfirmation) {
    const confirmationToken = input.confirmationToken as string;
    const confirmationSecret = Deno.env.get("SUPABASE_JWT_SECRET") || geminiApiKey;
    const pending = await verifyConfirmationToken(confirmationToken, confirmationSecret);
    if (!pending || pending.userId !== userData.user.id || pending.restaurantId !== membership.restaurant_id || pending.role !== membership.role || typeof pending.action !== "string") return json({ error: "This confirmation is invalid or expired. Please prepare the action again." }, 409);
    if (consumedConfirmationTokens.has(confirmationToken)) return json({ error: "This confirmation has already been used." }, 409);
    consumedConfirmationTokens.add(confirmationToken);
    const result = await executeWrite(userClient, userData.user.id, membership.restaurant_id, membership.role, pending.action, pending.data);
    if (result.status === "success") return json({ message: result.message });
    return json({ error: result.message }, result.status === "unavailable" ? 403 : 400);
  }

  let conversation = (input.messages as Array<{ role: string; content: string }>).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content.trim() }]
  }));

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
    const timezone = restaurant.timezone || "UTC";
    const maxToolRounds = 2;
    for (let round = 0; round <= maxToolRounds; round += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), geminiTimeoutMs);
      const requestStartedAt = Date.now();
      console.info("ERP Assistant Gemini request started.", {
        model: geminiModel,
        requestStartedAt: new Date(requestStartedAt).toISOString(),
        messageCount: conversation.length,
        toolRound: round
      });
      let geminiResponse: Response;
      try {
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction(restaurant.name, membership.role) }] },
            contents: conversation,
            tools: [{ functionDeclarations: toolDeclarations }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 512,
              thinkingConfig: { thinkingLevel: "LOW" }
            }
          })
        });
      } finally {
        clearTimeout(timeout);
      }
      console.info("ERP Assistant Gemini HTTP response received.", { status: geminiResponse.status, durationMs: Date.now() - requestStartedAt, toolRound: round });
      const result = await readGoogleResponse(geminiResponse);
      console.info("ERP Assistant Gemini response body parsed.", { status: geminiResponse.status, toolRound: round });
      if (!geminiResponse.ok) {
        console.error("Gemini API request failed.", { status: geminiResponse.status, statusText: geminiResponse.statusText, model: geminiModel, googleError: sanitizeGoogleError(result) });
        return json({ error: "The assistant could not respond right now. Please try again." }, 502);
      }

      const candidate = result?.candidates?.[0];
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      const functionCalls = parts.filter((part: { functionCall?: unknown }) => part.functionCall).map((part: { functionCall: { name?: unknown; args?: unknown } }) => part.functionCall);
      console.info("ERP Assistant Gemini tool calls detected.", {
        toolRound: round,
        maxToolRounds,
        hasFunctionCalls: functionCalls.length > 0,
        functionCallCount: functionCalls.length,
        functionNames: functionCalls.map((functionCall) => typeof functionCall.name === "string" ? functionCall.name : "<invalid>")
      });
      if (functionCalls.length) {
        const toolRoundLimitReached = round >= maxToolRounds || functionCalls.length > 3;
        console.info("ERP Assistant tool-round limit evaluated.", { toolRound: round, maxToolRounds, functionCallCount: functionCalls.length, toolRoundLimitReached });
        if (toolRoundLimitReached) return json({ error: "The assistant could not complete the live data lookup." }, 502);
        conversation.push(candidate.content);
        for (const functionCall of functionCalls) {
          const operation = typeof functionCall.name === "string" ? functionCall.name : "";
          const args = functionCall.args || {};
          console.info("ERP Assistant tool dispatch started.", { toolRound: round, functionName: operation || "<invalid>" });
          try {
            const isWrite = Boolean(writeRoles[operation]);
            const invalidArguments = (!operationTables[operation] && !isWrite) || !args || typeof args !== "object" || Array.isArray(args);
            if (invalidArguments) {
              conversation.push({ role: "user", parts: [{ functionResponse: { name: operation, response: { result: { status: "error", message: "The requested data operation or arguments are not supported." } } } }] });
              console.info("ERP Assistant tool dispatch completed.", { toolRound: round, functionName: operation || "<invalid>", resultStatus: "error" });
              continue;
            }
            if (isWrite) {
              const prepared = await prepareWrite(userClient, membership.restaurant_id, membership.role, operation, args);
              if (prepared.status === "pending_confirmation") {
                const confirmationSecret = Deno.env.get("SUPABASE_JWT_SECRET") || geminiApiKey;
                const confirmationToken = await signConfirmationPayload({ version: 1, userId: userData.user.id, restaurantId: membership.restaurant_id, role: membership.role, action: operation, data: prepared.data, expiresAt: Date.now() + 10 * 60 * 1000, nonce: crypto.randomUUID() }, confirmationSecret);
                console.info("ERP Assistant tool dispatch completed.", { toolRound: round, functionName: operation, resultStatus: "pending_confirmation" });
                return json({ message: "Please review this proposed record and choose Confirm or Cancel.", pendingAction: { token: confirmationToken, action: operation, title: prepared.title, fields: prepared.fields, expiresAt: Date.now() + 10 * 60 * 1000 } });
              }
              conversation.push({ role: "user", parts: [{ functionResponse: { name: operation, response: { result: prepared } } }] });
              console.info("ERP Assistant tool dispatch completed.", { toolRound: round, functionName: operation, resultStatus: prepared.status });
              continue;
            }
            const toolResult = Object.keys(args).length > 0
              ? { status: "error", message: "This read operation does not accept arguments." }
              : await readOperation(userClient, membership.restaurant_id, membership.role, operation, timezone);
            conversation.push({ role: "user", parts: [{ functionResponse: { name: operation, response: { result: toolResult } } }] });
            console.info("ERP Assistant tool dispatch completed.", { toolRound: round, functionName: operation, resultStatus: toolResult.status });
          } catch (error) {
            console.error("ERP Assistant tool dispatch threw an exception.", { toolRound: round, functionName: operation || "<invalid>", errorName: error instanceof Error ? error.name : "UnknownError" });
            throw error;
          }
        }
        continue;
      }

      const text = parts.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "").join("").trim();
      console.info("ERP Assistant final text evaluated.", { toolRound: round, hasUsableText: Boolean(text), responsePartCount: parts.length });
      if (!text) {
        console.error("Gemini returned no usable assistant text.", { status: geminiResponse.status });
        return json({ error: "The assistant returned no usable answer. Please try again." }, 502);
      }
      console.info("ERP Assistant text extracted.", { characterCount: text.length });
      return json({ message: text });
    }
    return json({ error: "The assistant could not complete the live data lookup." }, 502);
  } catch (error) {
    console.error("Could not reach Gemini.", { message: error instanceof Error && error.name === "AbortError" ? "Gemini request timed out." : errorMessage(error) });
    return json({ error: "The assistant is temporarily unavailable. Please try again." }, 502);
  }
});
