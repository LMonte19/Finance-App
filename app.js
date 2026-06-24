import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://eatxkhhpjruwwibhcubf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: "loan-ledger-auth",
  },
});

const qs = (id) => document.getElementById(id);
const setDebug = (msg) => { const el = qs("debug"); if (el) el.textContent = msg || ""; };
const safe = (fn) => (...args) => fn(...args).catch((e) => { console.error(e); setDebug(e?.message || String(e)); alert(e?.message || String(e)); });

let currentProfile = null;
let isBooting = false;
let bootedOnce = false;
let creatingNewBorrower = false;
let pendingNewLoanFunding = [];

function openMenu() { qs("sideMenu")?.classList.add("open"); qs("menuOverlay")?.classList.add("open"); }
function closeMenu() { qs("sideMenu")?.classList.remove("open"); qs("menuOverlay")?.classList.remove("open"); }
function openPage(targetId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  const matchingTab = document.querySelector(`.tab-btn[data-page="${targetId}"]`);
  if (matchingTab) matchingTab.classList.add("active");
  qs(targetId)?.classList.add("active-page");
  closeMenu();
}
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => { btn.onclick = () => openPage(btn.dataset.page); });
  document.querySelectorAll(".menu-link").forEach((btn) => { btn.onclick = () => openPage(btn.dataset.page); });
  if (qs("btnMenu")) qs("btnMenu").onclick = openMenu;
  if (qs("btnCloseMenu")) qs("btnCloseMenu").onclick = closeMenu;
  if (qs("menuOverlay")) qs("menuOverlay").onclick = closeMenu;
}
function ensureDefaultsButtons() {
  if (!qs("btnSaveDefaultRates")) {
    const rateCard = qs("defaultManagementRate")?.closest(".card");
    if (rateCard) {
      const btn = document.createElement("button");
      btn.id = "btnSaveDefaultRates";
      btn.type = "button";
      btn.textContent = "Guardar tasas predeterminadas";
      rateCard.appendChild(btn);
    }
  }
}
async function loadProfileByUserId(userId) {
  if (!userId) throw new Error("Missing userId for profile lookup.");
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Profile missing for user_id: " + userId);
  return data;
}
async function loadAppSetting(key) {
  const { data, error } = await supabase.from("app_settings").select("setting_value").eq("setting_key", key).maybeSingle();
  if (error) throw error;
  return data?.setting_value ?? null;
}
async function saveAppSetting(key, value) {
  const { error } = await supabase.rpc("set_app_setting", { p_key: key, p_value: value });
  if (error) throw error;
}
function renderDefaultFundingList(rows = []) {
  const el = qs("defaultFundingList");
  if (!el) return;
  const total = rows.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  el.innerHTML = rows.length ? `
    ${rows.map((row) => `
      <div class="compact-card" data-partner-id="${row.partner_user_id}" data-percent="${row.funding_percent}" data-partner-name="${row.partner_name}">
        <strong>${row.partner_name}</strong><br>
        <span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span>
      </div>
    `).join("")}
    <div style="margin-top:10px"><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
    ${Math.abs(total - 1) > 0.001 ? `<div style="color:#ffd27a;margin-top:8px">La distribución debe sumar 100%.</div>` : ""}
  ` : "No hay distribución predeterminada guardada.";
}
function renderPendingNewLoanFunding() {
  const el = qs("newLoanFundingList");
  if (!el) return;
  const total = pendingNewLoanFunding.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  el.innerHTML = pendingNewLoanFunding.length ? `
    ${pendingNewLoanFunding.map((row) => `
      <div class="compact-card">
        <strong>${row.partner_name}</strong><br>
        <span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span>
      </div>
    `).join("")}
    <div style="margin-top:10px"><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
    ${Math.abs(total - 1) > 0.001 ? `<div style="color:#ffd27a;margin-top:8px">La distribución debe sumar 100%.</div>` : ""}
  ` : "Sin distribución agregada todavía.";
}
function updateLoanFunderRatePreview() {
  const total = Number(qs("loanTotalRate")?.value || 0);
  const mgmt = Number(qs("loanMgmtRate")?.value || 0);
  const funders = total - mgmt;
  if (qs("loanFunderRatePreview")) qs("loanFunderRatePreview").textContent = funders >= 0 ? `Socios: ${funders.toFixed(2)}%` : "Porcentaje inválido.";
}
async function loadDefaultsIntoSettingsUI() {
  const rates = await loadAppSetting("loan_defaults");
  const funding = await loadAppSetting("default_funding_split");
  if (qs("defaultInterestRate")) qs("defaultInterestRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("defaultManagementRate")) qs("defaultManagementRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
  renderDefaultFundingList(funding ?? []);
}
async function prefillLoanDefaults(force = false) {
  const rates = await loadAppSetting("loan_defaults");
  const funding = await loadAppSetting("default_funding_split");
  if (qs("loanTotalRate")) qs("loanTotalRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("loanMgmtRate")) qs("loanMgmtRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
  updateLoanFunderRatePreview();
  if (force || pendingNewLoanFunding.length === 0) {
    pendingNewLoanFunding = (funding ?? []).map((row) => ({ partner_user_id: row.partner_user_id, funding_percent: Number(row.funding_percent), partner_name: row.partner_name }));
    renderPendingNewLoanFunding();
  }
}
async function refreshFundingPartnerSelects() {
  const { data, error } = await supabase.from("profiles").select("user_id, full_name, role").in("role", ["ADMIN", "PARTNER"]).order("full_name", { ascending: true });
  if (error) throw error;
  const options = (data ?? []).map((p) => `<option value="${p.user_id}">${p.full_name || "Sin nombre"} (${p.role})</option>`).join("");
  ["newLoanFundingPartner", "defaultFundingPartner"].forEach((id) => { if (qs(id)) qs(id).innerHTML = options; });
}
async function refreshBorrowers() {
  const { data, error } = await supabase.from("borrowers").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  if (qs("borrowerList")) {
    qs("borrowerList").innerHTML = (data ?? []).map((b) => `
      <div class="compact-card" style="cursor:pointer" data-borrower-id="${b.id}">
        <strong>${b.full_name}</strong><br>
        <span class="muted">${b.phone ?? "Sin teléfono"}${b.notes ? ` | ${b.notes}` : ""}</span>
      </div>
    `).join("") || "No hay clientes todavía.";
    document.querySelectorAll("[data-borrower-id]").forEach((el) => { el.onclick = () => window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: el.dataset.borrowerId } })); });
  }
  if (qs("loanBorrower")) qs("loanBorrower").innerHTML = (data ?? []).map((b) => `<option value="${b.id}">${b.full_name}</option>`).join("");
}
function addPendingLoanFunding(event) {
  event?.preventDefault?.();
  const partner_user_id = qs("newLoanFundingPartner")?.value;
  const percent = Number(qs("newLoanFundingPercent")?.value || 0);
  if (!partner_user_id || !percent) return alert("Socio y porcentaje son requeridos.");
  const partner_name = qs("newLoanFundingPartner").selectedOptions[0]?.textContent || "Socio";
  const funding_percent = percent / 100;
  const index = pendingNewLoanFunding.findIndex((x) => x.partner_user_id === partner_user_id);
  if (index >= 0) pendingNewLoanFunding[index] = { partner_user_id, funding_percent, partner_name };
  else pendingNewLoanFunding.push({ partner_user_id, funding_percent, partner_name });
  qs("newLoanFundingPercent").value = "";
  renderPendingNewLoanFunding();
}
async function addBorrower() {
  if (!currentProfile || !["ADMIN", "AGENT"].includes(currentProfile.role)) return alert("Solo Admin/Agente puede agregar clientes.");
  const full_name = qs("bName")?.value.trim();
  if (!full_name) return alert("Nombre requerido.");
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("borrowers").insert({ full_name, phone: qs("bPhone")?.value.trim() || null, notes: qs("bNotes")?.value.trim() || null, created_by: userData.user.id });
  if (error) throw error;
  qs("bName").value = ""; qs("bPhone").value = ""; qs("bNotes").value = "";
  await refreshBorrowers();
}
async function saveDefaultRates() {
  if (!currentProfile || currentProfile.role !== "ADMIN") return alert("Solo Admin puede actualizar valores predeterminados.");
  const default_total_monthly_rate = Number(qs("defaultInterestRate")?.value || 0);
  const default_management_rate = Number(qs("defaultManagementRate")?.value || 0);
  if (!default_total_monthly_rate || default_management_rate < 0) return alert("Ingresa tasas válidas.");
  if (default_management_rate > default_total_monthly_rate) return alert("Administración no puede exceder el interés total.");
  await saveAppSetting("loan_defaults", { default_total_monthly_rate, default_management_rate });
  await prefillLoanDefaults(true);
  alert("Tasas predeterminadas guardadas.");
}
async function saveDefaultFunding() {
  if (!currentProfile || currentProfile.role !== "ADMIN") return alert("Solo Admin puede actualizar valores predeterminados.");
  const partner_user_id = qs("defaultFundingPartner")?.value;
  const percent = Number(qs("defaultFundingPercent")?.value || 0);
  if (!partner_user_id || !percent) return alert("Socio y porcentaje son requeridos.");
  const partner_name = qs("defaultFundingPartner").selectedOptions[0]?.textContent || "Socio";
  const current = (await loadAppSetting("default_funding_split")) ?? [];
  const funding_percent = percent / 100;
  const index = current.findIndex((x) => x.partner_user_id === partner_user_id);
  const row = { partner_user_id, partner_name, funding_percent };
  if (index >= 0) current[index] = row;
  else current.push(row);
  await saveAppSetting("default_funding_split", current);
  qs("defaultFundingPercent").value = "";
  await loadDefaultsIntoSettingsUI();
  await prefillLoanDefaults(true);
  alert("Distribución predeterminada guardada.");
}
function initHandlers() {
  if (qs("btnSignIn")) qs("btnSignIn").onclick = safe(async () => {
    const btn = qs("btnSignIn");
    btn.disabled = true;
    try {
      setDebug("Iniciando sesión...");
      const { data, error } = await supabase.auth.signInWithPassword({ email: qs("email").value.trim(), password: qs("password").value.trim() });
      if (error) throw error;
      const session = data?.session || (await supabase.auth.getSession()).data.session;
      await bootFromSession(session, "signInHandler");
    } finally { btn.disabled = false; }
  });
  if (qs("btnSignOut")) qs("btnSignOut").onclick = safe(async () => { await supabase.auth.signOut(); });
  if (qs("btnToggleNewBorrower")) qs("btnToggleNewBorrower").onclick = () => {
    creatingNewBorrower = !creatingNewBorrower;
    qs("newBorrowerFields").style.display = creatingNewBorrower ? "block" : "none";
    qs("btnToggleNewBorrower").textContent = creatingNewBorrower ? "Usar cliente existente" : "+ Nuevo cliente";
  };
  if (qs("btnAddBorrower")) qs("btnAddBorrower").onclick = safe(addBorrower);
  if (qs("btnAddNewLoanFunding")) qs("btnAddNewLoanFunding").onclick = addPendingLoanFunding;
  if (qs("btnSaveDefaultFunding")) qs("btnSaveDefaultFunding").onclick = safe(saveDefaultFunding);
  if (qs("btnSaveDefaultRates")) qs("btnSaveDefaultRates").onclick = safe(saveDefaultRates);
}
async function setSignedInUI(profile) {
  currentProfile = profile;
  qs("authCard").style.display = "none";
  qs("app").style.display = "block";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "inline-block";
  if (qs("whoami")) qs("whoami").textContent = `${profile.full_name ?? "Usuario"} • ${profile.role}`;
  if (qs("rolePill")) qs("rolePill").textContent = profile.role;
  ensureDefaultsButtons();
  initTabs();
  initHandlers();
  qs("loanTotalRate") && (qs("loanTotalRate").oninput = updateLoanFunderRatePreview);
  qs("loanMgmtRate") && (qs("loanMgmtRate").oninput = updateLoanFunderRatePreview);
  setDebug("Cargando clientes..."); await refreshBorrowers();
  setDebug("Cargando valores predeterminados..."); await refreshFundingPartnerSelects(); await loadDefaultsIntoSettingsUI(); await prefillLoanDefaults(true);
  setDebug("");
}
async function setSignedOutUI() {
  currentProfile = null;
  if (qs("authCard")) qs("authCard").style.display = "block";
  if (qs("app")) qs("app").style.display = "none";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "none";
  if (qs("whoami")) qs("whoami").textContent = "Sesión no iniciada";
  if (qs("rolePill")) qs("rolePill").textContent = "rol";
  setDebug("");
}
async function bootFromSession(session, source = "unknown") {
  if (isBooting) return;
  isBooting = true;
  try {
    if (!session?.user) { bootedOnce = true; await setSignedOutUI(); return; }
    const profile = await loadProfileByUserId(session.user.id);
    await setSignedInUI(profile);
    bootedOnce = true;
    console.log("boot ok", source);
  } finally { isBooting = false; }
}
supabase.auth.onAuthStateChange((_event, session) => {
  if (!bootedOnce && !_event.includes("TOKEN_REFRESHED")) bootFromSession(session, "authState");
  if (_event === "SIGNED_OUT") setSignedOutUI();
});
(async function init() {
  initTabs();
  initHandlers();
  const { data } = await supabase.auth.getSession();
  await bootFromSession(data.session, "initialSession");
})();
