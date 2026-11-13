import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const origin = "https://lmonte19.github.io";
const ownerId = "984c2e7c-2506-4c7a-8510-15d1a14815b0";
const allowedRoles = new Set(["PARTNER", "AGENT"]);
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (status, body) => Response.json(body, { status, headers: cors });
const fail = (status, message) => reply(status, { message });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

Deno.serve(async (req) => {
  if (req.headers.get("Origin") && req.headers.get("Origin") !== origin) return fail(403, "Origen no permitido.");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail(405, "Método no permitido.");
  const token = req.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return fail(401, "Inicia sesión de nuevo.");
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publicClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), options);
    const { data: identity, error: authError } = await publicClient.auth.getUser(token);
    if (authError || !identity.user) return fail(401, "Inicia sesión de nuevo.");
    if (identity.user.id !== ownerId) return fail(403, "No tienes permiso para administrar el acceso.");

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), options);
    const { data: owner, error: ownerError } = await db.from("profiles").select("role").eq("user_id", ownerId).maybeSingle();
    if (ownerError) throw ownerError;
    if (owner?.role !== "ADMIN") return fail(403, "No tienes permiso para administrar el acceso.");

    let input;
    try {
      const raw = await req.text();
      if (raw.length > 4096) return fail(413, "Solicitud demasiado larga.");
      input = JSON.parse(raw);
    } catch { return fail(400, "Solicitud inválida."); }
    if (!input || typeof input !== "object") return fail(400, "Solicitud inválida.");

    if (input.action === "list") {
      const { data: profiles, error } = await db.from("profiles").select("user_id, full_name, role").in("role", [...allowedRoles]).order("full_name");
      if (error) throw error;
      const users = await Promise.all(profiles.map(async profile => {
        const result = await db.auth.admin.getUserById(profile.user_id);
        if (result.error) throw result.error;
        const user = result.data.user;
        return { ...profile, email: user.email, google: user.identities?.some(item => item.provider === "google") ?? false };
      }));
      return reply(200, { users });
    }

    if (!["email", "password"].includes(input.action) || typeof input.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id) ||
      input.id === ownerId) return fail(400, "Selecciona una cuenta válida.");
    const { data: target, error: targetError } = await db.from("profiles").select("role").eq("user_id", input.id).maybeSingle();
    if (targetError) throw targetError;
    if (!allowedRoles.has(target?.role)) return fail(403, "Solo puedes modificar cuentas de socios o agentes.");
    const result = await db.auth.admin.getUserById(input.id);
    if (result.error) throw result.error;
    const user = result.data.user;
    const knownEmail = typeof input.currentEmail === "string" ? input.currentEmail : "";
    if (!knownEmail || user.email !== knownEmail) return fail(409, "El correo cambió. Cierra este panel y vuelve a abrirlo.");
    if (input.confirm !== true) return fail(400, "Confirma el cambio de acceso.");

    let attributes;
    if (input.action === "email") {
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!emailPattern.test(email) || email.length > 254 || email === user.email?.toLowerCase())
        return fail(400, "Ingresa un correo nuevo válido.");
      if (user.identities?.some(item => item.provider !== "email"))
        return fail(409, "Esta cuenta ya tiene un acceso externo conectado. Puedes restablecer su contraseña; para cambiar el correo, primero hay que desvincular ese acceso.");
      attributes = { email, email_confirm: true };
    } else {
      const password = input.password;
      if (typeof password !== "string" || password.length < 12 || new TextEncoder().encode(password).length > 72 || password.trim() !== password)
        return fail(400, "Usa al menos 12 caracteres y un máximo de 72 bytes, sin espacios al principio ni al final.");
      attributes = { password };
    }
    const { data, error } = await db.auth.admin.updateUserById(input.id, attributes);
    if (["email_exists", "user_already_exists", "identity_already_exists"].includes(error?.code))
      return fail(409, "Ese correo ya tiene otra cuenta. Revisa el duplicado antes de continuar.");
    if (error?.code === "weak_password") return fail(400, "Elige una contraseña más fuerte.");
    if (error) throw error;
    console.info(JSON.stringify({ event: "app_access_changed", action: input.action, actor: ownerId, target: input.id }));
    return reply(200, { email: data.user.email });
  } catch (error) {
    console.error("Access management failed", error?.code ?? error?.name ?? "unknown");
    return fail(500, "No se pudo completar la operación. Vuelve a abrir el panel para comprobar el estado de la cuenta.");
  }
});
