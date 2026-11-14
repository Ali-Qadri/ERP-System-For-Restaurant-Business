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
  ["get_dashboard_summary", "Summarize today's available restaurant activity."]
].map(([name, description]) => ({
  name,
  description,
  parameters: { type: "OBJECT", properties: {} }
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

You are an informational help assistant for this restaurant ERP. Answer only questions about the application's existing features: dashboard and reports; employees; menu categories and menu items; tables and orders; reservations; inventory and suppliers; shifts and attendance; leave and replacement requests; expenses and payments; and restaurant settings.

Use simple, friendly language and clear step-by-step instructions. Tailor explanations to the verified role: owner users can manage restaurant settings, manager users can manage operational workflows, and staff_shared users should be guided only toward the sections available to staff. Do not claim that a role can access a section if the application restricts it.

When a live-data question is asked, use an approved read-only data operation when available. Explain the returned records accurately and distinguish zero results from unavailable data or a query failure. You may not infer or invent numbers.
Never invent screens, buttons, fields, reports, integrations, or data, and you must not ask for passwords, tokens, or sensitive credentials.
This assistant is informational only. Never create, edit, delete, approve, export, or otherwise mutate ERP records. Never execute SQL, call unapproved database tools, or provide instructions to bypass authentication, role restrictions, RLS, or restaurant boundaries.
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

  let input: { messages?: unknown };
  try {
    const requestBody = await request.text();
    if (requestBody.length > maxRequestBodyLength) return json({ error: "The assistant request is too large." }, 413);
    input = JSON.parse(requestBody);
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const validationError = validateMessages(input.messages);
  if (validationError) return json({ error: validationError }, 400);

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
      if (functionCalls.length) {
        if (round >= maxToolRounds || functionCalls.length > 3) return json({ error: "The assistant could not complete the live data lookup." }, 502);
        conversation.push(candidate.content);
        for (const functionCall of functionCalls) {
          const operation = typeof functionCall.name === "string" ? functionCall.name : "";
          const args = functionCall.args || {};
          const invalidArguments = !operationTables[operation] || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length > 0;
          const toolResult = invalidArguments
            ? { status: "error", message: "The requested data operation or arguments are not supported." }
            : await readOperation(userClient, membership.restaurant_id, membership.role, operation, timezone);
          conversation.push({ role: "user", parts: [{ functionResponse: { name: operation, response: { result: toolResult } } }] });
        }
        continue;
      }

      const text = parts.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "").join("").trim();
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
