import { roleName, readViewer } from './combined-workspace-ui.js?v=2';
import { getPageSessionId } from './page-read-runtime.js?v=1';
import { ACCESS_OWNER_ID } from './admin-access.js?v=2';
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
let loadedSession = null;
let profileRead = null;
let profileGeneration = 0;

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
  const session = getPageSessionId();
  if (!session) return null;
  if (loadedSession === session) return;
  if (profileRead) return profileRead;
  const generation = profileGeneration;
  profileRead = (async () => {
  const data = await readViewer(supabase);
  if (generation !== profileGeneration || session !== getPageSessionId()) return;
  currentRole = data?.role || null;
  currentName = data?.full_name || "Usuario";
  loadedSession = session;
  return data;
  })().finally(() => { profileRead = null; });
  return profileRead;
}

function applyOwnerOnlyVisibility() {
  const restricted = currentRole !== "ADMIN" || getPageSessionId() !== ACCESS_OWNER_ID;
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
    if (!getPageSessionId()) {
      currentRole = null;
      currentName = null;
      loadedSession = null;
      applyOwnerOnlyVisibility();
      qs("roleSecurityBanner")?.remove();
      return;
    }
    await loadCurrentProfile();

    addRoleBanner();
    applyOwnerOnlyVisibility();
  } catch (error) {
    console.error("Role guard error:", error);
  }
}

function resetProfileGuard() {
  profileGeneration++;
  loadedSession = null;
  currentRole = null;
  currentName = null;
  qs("roleSecurityBanner")?.remove();
  setTimeout(applyRoleGuards, 500);
}
supabase.auth.onAuthStateChange((event) => {
  if (["SIGNED_OUT", "INITIAL_SESSION", "USER_UPDATED"].includes(event)) resetProfileGuard();
});
window.addEventListener('loan-ledger:profile-updated', resetProfileGuard);

const observer = new MutationObserver(() => {
  clearTimeout(guardTimer);
  guardTimer = setTimeout(applyRoleGuards, 150);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(applyRoleGuards, 2000);
applyRoleGuards();
