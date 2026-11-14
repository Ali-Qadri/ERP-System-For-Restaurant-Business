import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedRoles = new Set(["owner", "manager", "staff_shared"]);
const geminiModel = "gemini-3.8-flash";
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

Never invent screens, buttons, fields, reports, integrations, or data. You cannot view live ERP records unless they are explicitly supplied in the conversation, and you must not ask for passwords, tokens, or sensitive credentials.
This assistant is informational only. Never create, edit, delete, approve, export, or otherwise mutate ERP records. Never execute SQL, call database tools, or provide instructions to bypass authentication, role restrictions, RLS, or restaurant boundaries.
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

  const { data: membership, error: membershipError } = await userClient
    .from("restaurant_members")
    .select("restaurant_id, role")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membershipError) return json({ error: "Your restaurant membership could not be verified." }, 500);
  if (!membership || !allowedRoles.has(membership.role)) return json({ error: "You do not have an active restaurant role for the assistant." }, 403);
  console.info("ERP Assistant restaurant membership verified.");

  const { data: restaurant, error: restaurantError } = await userClient
    .from("restaurants")
    .select("name")
    .eq("id", membership.restaurant_id)
    .maybeSingle();
  if (restaurantError || !restaurant) return json({ error: "Your restaurant could not be verified." }, 403);

  const contents = (input.messages as Array<{ role: string; content: string }>).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content.trim() }]
  }));

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), geminiTimeoutMs);
    const requestStartedAt = Date.now();
    console.info("ERP Assistant Gemini request started.", { model: geminiModel, messageCount: contents.length });
    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction(restaurant.name, membership.role) }] },
          contents,
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
    console.info("ERP Assistant Gemini HTTP response received.", { status: geminiResponse.status, durationMs: Date.now() - requestStartedAt });
    const result = await readGoogleResponse(geminiResponse);
    console.info("ERP Assistant Gemini response body parsed.", { status: geminiResponse.status });
    if (!geminiResponse.ok) {
      console.error("Gemini API request failed.", {
        status: geminiResponse.status,
        statusText: geminiResponse.statusText,
        model: geminiModel,
        googleError: sanitizeGoogleError(result)
      });
      return json({ error: "The assistant could not respond right now. Please try again." }, 502);
    }
    const candidateParts = result?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(candidateParts)
      ? candidateParts.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "").join("").trim()
      : "";
    if (!text) {
      console.error("Gemini returned no usable assistant text.", { status: geminiResponse.status });
      return json({ error: "The assistant returned no usable answer. Please try again." }, 502);
    }
    console.info("ERP Assistant text extracted.", { characterCount: text.length });
    console.info("ERP Assistant response returned to frontend.");
    return json({ message: text });
  } catch (error) {
    console.error("Could not reach Gemini.", { message: error instanceof Error && error.name === "AbortError" ? "Gemini request timed out." : errorMessage(error) });
    return json({ error: "The assistant is temporarily unavailable. Please try again." }, 502);
  }
});
