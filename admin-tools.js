import { readPageQuery, watchPage, isStalePageSession, fillInitialLoading, finishPageLoading, invalidatePageReads, loadingRows, getPageSessionId } from './page-read-runtime.js?v=1';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://eatxkhhpjruwwibhcubf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
let currentProfile = null;
let adminRefreshTimer = null;

function activePage(id) { return qs(id)?.classList.contains("active-page"); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso, days) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function money(n) { return Number(n || 0).toFixed(2); }
function card(html) { return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:10px;margin:8px 0;box-sizing:border-box;max-width:100%;">${html}</div>`; }

function ensureStyles() {
  if (qs("adminToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "adminToolsStyle";
  style.textContent = `
    .admin-tools-button{cursor:pointer;transition:filter .15s ease,transform .05s ease;}
    .admin-tools-button:hover{filter:brightness(1.18);}.admin-tools-button:active{transform:scale(.98);}
    .admin-danger{background:#7a2b2b!important}.admin-muted-btn{background:#333!important}
    .admin-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.admin-profile-card input,.admin-profile-card select{box-sizing:border-box;max-width:100%;}
    @media(max-width:650px){.admin-mini-grid{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);
}

async function getMyProfile(force = false) {
  if (currentProfile && !force) return currentProfile;
  const userId = getPageSessionId();
  if (!userId) return null;
  const { data, error } = await readPageQuery("my-profile:"+userId, () => supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(), {force});
  if (error) throw error;
  currentProfile = data;
  return data;
}

function ensurePage(id, title) {
  if (qs(id)) return qs(id);
  const app = qs("app");
  if (!app) return null;
  const page = document.createElement("div");
  page.id = id;
  page.className = "page";
  page.innerHTML = `<div class="card"><div style="font-weight:800;">${title}</div><div id="${id}Content" class="muted">Loading...</div></div>`;
  app.appendChild(page);
  return page;
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function insertMenuButton({ id, page, label, beforeDefaults = true, onOpen }) {
  const sideMenu = qs("sideMenu");
  if (!sideMenu || qs(id)) return;
  const btn = document.createElement("button");
  btn.id = id;
  btn.className = "menu-link admin-tools-button";
  btn.dataset.page = page;
  btn.textContent = label;
  btn.onclick = async (event) => { event.preventDefault(); event.stopPropagation(); openPage(page); await onOpen?.(); };
  const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
  if (beforeDefaults && defaultsBtn) sideMenu.insertBefore(btn, defaultsBtn);
  else sideMenu.appendChild(btn);
}

function ensureAdminMenuItems() {
  ensurePage("maintenancePage", "Maintenance");
  insertMenuButton({ id: "menuMaintenance", page: "maintenancePage", label: "Maintenance", beforeDefaults: false, onOpen: () => refreshMaintenancePage() });
}

async function refreshMaintenancePage({ force = false } = {}) {
  const content = qs("maintenancePageContent");
  if (!content) return;
  if (!force && content.dataset.loaded === "true") return;
  const profile = await getMyProfile();
  content.dataset.loaded = "true";
  content.innerHTML = `<div class="card"><div style="font-weight:800;">Maintenance</div><div class="muted">Admin-only maintenance tools.</div></div><div class="card"><div style="font-weight:800;">Reset Test Data</div><div class="muted">This clears borrowers, loans, due events, payments, payment allocations, and funding splits. It keeps profiles and defaults/settings.</div>${profile?.role === "ADMIN" ? `<button id="btnResetTestData" class="admin-tools-button admin-danger" type="button">Reset Test Data</button>` : `<div style="color:#ffd27a;">Only Admin can reset test data.</div>`}</div>`;
  const btn = qs("btnResetTestData");
  if (btn) {
    btn.onclick = async () => {
      const first = prompt("Type RESET to delete all test transaction data.");
      if (first !== "RESET") return alert("Reset cancelled.");
      if (!confirm("Final confirmation: delete all borrowers, loans, payments, due events, allocations, and funding splits?")) return;
      const { error } = await supabase.rpc("reset_test_data");
      if (error) return alert(error.message);
      alert("Test data reset. Hard refresh the app.");
    };
  }
}

async function refreshVisibleAdminTools() {
  try {
    ensureStyles();
    ensureAdminMenuItems();
    if (activePage("maintenancePage") && qs("maintenancePageContent")?.dataset.loaded !== "true") await refreshMaintenancePage();
  } catch (error) { if(!isStalePageSession(error))console.error(error); }
}

refreshVisibleAdminTools();
window.addEventListener('loan-ledger:profile-updated',()=>{currentProfile=null;});
fillInitialLoading("maintenancePageContent");
watchPage("maintenancePage", refreshVisibleAdminTools, {prefetch: () => getMyProfile(), reset: () => {const n=qs("maintenancePageContent");if(n){delete n.dataset.loaded;n.innerHTML=loadingRows();}}});
