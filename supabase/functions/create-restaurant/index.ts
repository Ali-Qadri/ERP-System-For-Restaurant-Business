import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const configuredAppUrl = Deno.env.get("APP_URL")?.trim() || "";
let appUrl = "";
let appUrlError = "";

try {
  const parsedAppUrl = new URL(configuredAppUrl);
  if (!configuredAppUrl || !["http:", "https:"].includes(parsedAppUrl.protocol) || parsedAppUrl.username || parsedAppUrl.password || parsedAppUrl.search || parsedAppUrl.hash || (parsedAppUrl.pathname !== "/" && parsedAppUrl.pathname !== "")) {
    throw new Error("APP_URL must be a valid HTTP or HTTPS application origin without a path, query string, or hash.");
  }
  appUrl = parsedAppUrl.origin;
} catch {
  appUrlError = "The function is not configured correctly. Set APP_URL to the frontend HTTP or HTTPS origin.";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": appUrl || "null",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unexpected server error.";

class ConflictError extends Error {}

function isDuplicateEmailError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const authError = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = String(authError.code || "").toLowerCase();
  const message = String(authError.message || "").toLowerCase();
  return ["email_exists", "user_already_exists"].includes(code) ||
    (Number(authError.status) === 422 && /(already registered|already exists|already been registered|email.*exists)/i.test(message)) ||
    /(already registered|already exists|already been registered)/i.test(message);
}

async function cleanupCreatedResources(adminClient: ReturnType<typeof createClient>, restaurantId: string, invitedUserId: string | null) {
  const failures: string[] = [];

  if (invitedUserId) {
    const { error } = await adminClient.auth.admin.deleteUser(invitedUserId);
    if (error) {
      console.error("Failed to clean up invited Auth user after restaurant creation failure.", {
        userId: invitedUserId,
        error: error.message,
        code: error.code,
        status: error.status
      });
      failures.push("invited Auth user");
    }
  }

  const { error: restaurantCleanupError } = await adminClient.from("restaurants").delete().eq("id", restaurantId);
  if (restaurantCleanupError) {
    console.error("Failed to clean up restaurant after restaurant creation failure.", {
      restaurantId,
      error: restaurantCleanupError.message,
      code: restaurantCleanupError.code,
      details: restaurantCleanupError.details,
      hint: restaurantCleanupError.hint
    });
    failures.push("restaurant");
  }

  return failures;
}

function validateInput(input: Record<string, unknown>) {
  const fields = ["name", "slug", "currency_code", "timezone", "owner_full_name", "owner_email"];
  const missing = fields.filter((field) => typeof input[field] !== "string" || !String(input[field]).trim());
  if (missing.length) return `Missing required fields: ${missing.join(", ")}.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(input.slug).trim())) return "Slug must contain only lowercase letters, numbers, and hyphens.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.owner_email).trim())) return "Owner email address is invalid.";
  return null;
}

serve(async (request) => {
  if (appUrlError) return json({ error: appUrlError }, 500);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "The function is not configured correctly." }, 500);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication is required." }, 401);
  const accessToken = authorization.replace("Bearer ", "");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return json({ error: "Your session is invalid or expired." }, 401);

  const { data: adminRow, error: adminCheckError } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (adminCheckError) return json({ error: "Platform admin access could not be verified." }, 500);
  if (!adminRow) return json({ error: "Only platform administrators can create restaurants." }, 403);

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const validationError = validateInput(input);
  if (validationError) return json({ error: validationError }, 400);

  const restaurant = {
    name: String(input.name).trim(),
    slug: String(input.slug).trim(),
    currency_code: String(input.currency_code).trim(),
    timezone: String(input.timezone).trim(),
    status: "pending",
    created_by: userData.user.id
  };

  const { data: existingRestaurant, error: slugCheckError } = await adminClient
    .from("restaurants")
    .select("id")
    .eq("slug", restaurant.slug)
    .maybeSingle();
  if (slugCheckError) return json({ error: "Restaurant slug could not be checked." }, 500);
  if (existingRestaurant) return json({ error: "A restaurant with this URL slug already exists." }, 409);

  const { data: restaurantRow, error: restaurantError } = await adminClient
    .from("restaurants")
    .insert(restaurant)
    .select("id")
    .single();
  if (restaurantError || !restaurantRow) {
    if (restaurantError?.code === "23505") return json({ error: "A restaurant with this URL slug already exists." }, 409);
    return json({ error: "Restaurant could not be created." }, 500);
  }

  let invitedUserId: string | null = null;
  try {
    const redirectTo = `${appUrl}/`;
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      String(input.owner_email).trim(),
      { data: { full_name: String(input.owner_full_name).trim() }, redirectTo }
    );
    invitedUserId = inviteData?.user?.id || null;
    if (inviteError || !inviteData?.user) {
      if (isDuplicateEmailError(inviteError)) throw new ConflictError("An Auth account already exists for this owner email.");
      throw new Error("The owner invitation could not be sent.");
    }

    const { error: membershipError } = await adminClient.from("restaurant_members").insert({
      restaurant_id: restaurantRow.id,
      user_id: invitedUserId,
      role: "owner",
      status: "active"
    });
    if (membershipError) throw new Error("The restaurant owner membership could not be created.");
  } catch (error) {
    const cleanupFailures = await cleanupCreatedResources(adminClient, restaurantRow.id, invitedUserId);
    if (cleanupFailures.length) {
      console.error("Restaurant creation cleanup was incomplete.", {
        restaurantId: restaurantRow.id,
        cleanupFailures,
        originalError: errorMessage(error)
      });
      return json({ error: `${errorMessage(error)} Creation failed and manual cleanup may be required.` }, 500);
    }
    return json({ error: errorMessage(error) }, error instanceof ConflictError ? 409 : 500);
  }

  return json({ success: true, restaurant_id: restaurantRow.id, owner_user_id: invitedUserId });
});
