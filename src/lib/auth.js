import { requireSupabase } from "./supabaseClient.js";

const SUPPORTED_ROLES = new Set(["owner", "manager", "staff_shared"]);

function friendlyAuthError(error) {
  if (/invalid login credentials/i.test(error?.message || "")) return "The email or password is incorrect.";
  if (/email not confirmed/i.test(error?.message || "")) return "Please confirm your email address before signing in.";
  return "We could not sign you in right now. Please try again.";
}

async function getProfile(user) {
  const { data, error } = await requireSupabase().from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw new Error("Your profile could not be loaded.");
  return data || {};
}

async function getMembership(user) {
  const { data, error } = await requireSupabase()
    .from("restaurant_members")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Your restaurant membership could not be loaded.");
  if (!data) throw new Error("Your account does not have an active restaurant membership. Ask an owner to activate your access.");
  return data;
}

async function isPlatformAdmin(user) {
  const { data, error } = await requireSupabase()
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Your platform access could not be verified.");
  return Boolean(data);
}

export async function getAuthContext(session) {
  if (!session?.user) return null;
  if (await isPlatformAdmin(session.user)) {
    return {
      session,
      user: session.user,
      profile: null,
      membership: null,
      role: "platform_admin",
      accountType: "platform_admin"
    };
  }
  const [profile, membership] = await Promise.all([getProfile(session.user), getMembership(session.user)]);
  const candidateRole = membership.role || profile.role || session.user.user_metadata?.role;
  const role = SUPPORTED_ROLES.has(candidateRole) ? candidateRole : "staff_shared";
  return { session, user: session.user, profile, membership, role, accountType: "restaurant" };
}

export async function signIn(email, password) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error));
  try {
    return await getAuthContext(data.session);
  } catch (contextError) {
    await client.auth.signOut();
    throw contextError;
  }
}

export async function getCurrentAuthContext() {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw new Error("Your session could not be restored. Please sign in again.");
  return data.session ? getAuthContext(data.session) : null;
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw new Error("We could not sign you out. Please try again.");
}
