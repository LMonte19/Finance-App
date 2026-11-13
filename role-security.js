import { roleName } from './combined-workspace-ui.js?v=2';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://eatxkhhpjruwwibhcubf.supabase.co",
  "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "loan-ledger-auth",
    },
  }
);

const qs = (id) => document.getElementById(id);
let currentRole = null;
let currentName = null;
let guardTimer = null;

function setRestricted(element, restricted) {
  if (!element) return;
  if (restricted && element.dataset.roleHidden !== "true") {
    element.dataset.roleHidden = "true";
    element.style.display = "none";
  } else if (!restricted && element.dataset.roleHidden === "true") {
    delete element.dataset.roleHidden;
    element.style.display = "";
  }
}

async function loadCurrentProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  currentRole = data?.role || null;
  currentName = data?.full_name || user.email || "Usuario";
  return data;
}

function applyOwnerOnlyVisibility() {
  const restricted = currentRole !== "ADMIN";
  for (const id of ["menuMaintenance", "btnResetTestData"]) setRestricted(qs(id), restricted);
}

function addRoleBanner() {
  if (!currentRole || qs("roleSecurityBanner")) return;
  const app = qs("app");
  if (!app) return;

  const banner = document.createElement("div");
  banner.id = "roleSecurityBanner";
  banner.className = "card";
  banner.style.border = "1px solid #2b63ff";
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div>
        <strong data-role-viewer></strong><br>
        <span class="muted">Role: ${roleName(currentRole)}</span>
      </div>
      <span class="pill">Permissions active</span>
    </div>
  `;
  banner.querySelector("[data-role-viewer]").textContent = currentName;
  app.insertBefore(banner, app.firstChild);
}

async function applyRoleGuards() {
  try {
    if (!currentRole) await loadCurrentProfile();
    if (!currentRole) return;

    addRoleBanner();
    applyOwnerOnlyVisibility();
  } catch (error) {
    console.error("Role guard error:", error);
  }
}

supabase.auth.onAuthStateChange(() => {
  currentRole = null;
  currentName = null;
  setTimeout(applyRoleGuards, 500);
});
window.addEventListener('loan-ledger:profile-updated',()=>{currentRole=null;currentName=null;setTimeout(applyRoleGuards,0);});

const observer = new MutationObserver(() => {
  clearTimeout(guardTimer);
  guardTimer = setTimeout(applyRoleGuards, 150);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(applyRoleGuards, 2000);
applyRoleGuards();
