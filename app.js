import { setPageSession, invalidatePageReads, readPageQuery, getPageSessionId, isStalePageSession } from './page-read-runtime.js?v=1';
import { ACCESS_OWNER_ID, openAdminAccess } from './admin-access.js?v=2';
import { esc, roleName } from './combined-workspace-ui.js?v=2';
import { floatingHeader, openFloatingPanel } from './floating-panel.js?v=1';
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
let activeAuthUser = null;
let authAttempt = 0;
let authBoot = null;
const oauthReturn = new URL(window.location.href);
const oauthError = oauthReturn.searchParams.get("error") || oauthReturn.searchParams.get("error_code")
  || new URLSearchParams(oauthReturn.hash.slice(1)).get("error") || new URLSearchParams(oauthReturn.hash.slice(1)).get("error_code");
let creatingNewBorrower = false;
let pendingNewLoanFunding = [];

function openMenu() { qs("sideMenu")?.classList.add("open"); qs("menuOverlay")?.classList.add("open"); }
function closeMenu() { qs("sideMenu")?.classList.remove("open"); qs("menuOverlay")?.classList.remove("open"); }
function openPage(targetId) {
  targetId = ({profilesPage:'partnersPage',reportsPage:'activityPage'})[targetId] || targetId;
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
function showThemeButton(show) {
  const btn = qs("btnThemeToggle");
  if (!btn) return;
  btn.style.display = show ? "inline-block" : "none";
  window.loanLedgerTheme?.initThemeButton?.();
}
async function openSignInMethods(trigger, returned = false) {
  const owner = getPageSessionId();
  if (!owner || currentProfile?.role !== "ADMIN") return;
  const panel = openFloatingPanel({
    label: "Métodos de acceso", trigger,
    html: `${floatingHeader("Métodos de acceso")}<div class="ll-floating-scroll">
      <p id="signInMethodsStatus" class="ll-floating-help" role="status">Consultando métodos de acceso…</p>
      <div class="ll-floating-actions" style="margin-top:18px"><button id="btnLinkGoogle" type="button" disabled>Conectar Google</button></div>
    </div>`,
  });
  if (!panel) return;
  const status = qs("signInMethodsStatus"), button = qs("btnLinkGoogle");
  const { data, error } = await supabase.auth.getUserIdentities();
  if (!panel.isCurrent()) return;
  if (error) { status.textContent = "No se pudieron consultar tus métodos de acceso. Vuelve a abrir este panel."; return; }
  const google = data.identities.find(identity => identity.provider === "google");
  if (google) {
    button.hidden = true;
    status.textContent = `Google está conectado${google.identity_data?.email ? " como " + google.identity_data.email : ""}. Ya puedes usar «Continuar con Google» para entrar a este mismo perfil.`;
    return;
  }
  status.textContent = returned
    ? "No se conectó Google. Si ese correo ya se usó para entrar por separado, pide al administrador que revise la cuenta duplicada."
    : "Elige tu cuenta de Google para entrar al mismo perfil. Tu acceso con correo y contraseña seguirá funcionando.";
  button.disabled = false;
  button.onclick = async () => {
    if (getPageSessionId() !== owner || currentProfile?.role !== "ADMIN") return;
    button.disabled = true;
    const redirect = new URL(window.location.href);
    redirect.hash = "";
    redirect.search = "";
    try {
      sessionStorage.setItem("loanLedger.googleLinkPending", owner);
      const { data: link, error: linkError } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: redirect.toString(), queryParams: { prompt: "select_account" }, skipBrowserRedirect: true },
      });
      if (linkError) throw linkError;
      if (!link?.url || !panel.isCurrent()) throw new Error("Link unavailable");
      window.location.assign(link.url);
    } catch (failure) {
      sessionStorage.removeItem("loanLedger.googleLinkPending");
      if (!panel.isCurrent()) return;
      status.textContent = failure.code === "manual_linking_disabled"
        ? "La conexión con Google aún no está habilitada. Pide al administrador que la active."
        : "No se pudo abrir Google. Inténtalo de nuevo.";
      button.disabled = false;
    }
  };
}
async function loadProfileByUserId(userId) {
  if (!userId) throw new Error("Missing userId for profile lookup.");
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
async function loadAppSetting(key) {
  const { data, error } = await readPageQuery("setting:"+key, () => supabase.from("app_settings").select("setting_value").eq("setting_key", key).maybeSingle());
  if (error) throw error;
  return data?.setting_value ?? null;
}
async function saveAppSetting(key, value) {
  const { error } = await supabase.rpc("set_app_setting", { p_key: key, p_value: value });
  if (error) throw error;
  invalidatePageReads();
}
function renderPendingNewLoanFunding() {
  const el = qs("newLoanFundingList");
  if (!el) return;
  const total = pendingNewLoanFunding.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  el.innerHTML = pendingNewLoanFunding.length ? `
    ${pendingNewLoanFunding.map((row) => `
      <div class="compact-card" data-partner-id="${esc(row.partner_user_id)}" data-percent="${Number(row.funding_percent)}" data-partner-name="${esc(row.partner_name)}">
        <strong>${esc(row.partner_name)}</strong><br>
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
  if (qs("defaultInterestRate")) qs("defaultInterestRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("defaultManagementRate")) qs("defaultManagementRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
}
async function prefillLoanDefaults(force = false) {
  const [rates, funding, people] = await Promise.all([loadAppSetting("loan_defaults"), loadAppSetting("default_funding_split"),readFundingPartners()]);
  if (qs("loanTotalRate")) qs("loanTotalRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("loanMgmtRate")) qs("loanMgmtRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
  updateLoanFunderRatePreview();
  if (force || pendingNewLoanFunding.length === 0) {
    const names=new Map(people.map(p=>[p.user_id,p.full_name]));
    pendingNewLoanFunding = (funding ?? []).map((row) => ({ partner_user_id: row.partner_user_id, funding_percent: Number(row.funding_percent), partner_name: names.get(row.partner_user_id)||row.partner_name }));
    renderPendingNewLoanFunding();
  }
}
async function readFundingPartners() {
  const { data, error } = await readPageQuery("funding-partners", () => supabase.from("profiles").select("user_id, full_name, role").in("role", ["ADMIN", "PARTNER"]).order("full_name", { ascending: true }));
  if (error) throw error;
  return data??[];
}
async function refreshFundingPartnerSelects() {
  const data=await readFundingPartners();
  const options = (data ?? []).map((p) => `<option value="${esc(p.user_id)}">${esc(p.full_name || "Sin nombre")} (${esc(p.role)})</option>`).join("");
  ["newLoanFundingPartner"].forEach((id) => { if (qs(id)) qs(id).innerHTML = options; });
}
async function refreshBorrowers() {
  const { data, error } = await readPageQuery("base-borrowers", () => supabase.from("borrowers").select("*").order("created_at", { ascending: false }));
  if (error) throw error;
  if (qs("borrowerList")) {
    qs("borrowerList").innerHTML = (data ?? []).map((b) => `
      <div class="compact-card" style="cursor:pointer" data-borrower-id="${esc(b.id)}">
        <strong>${esc(b.full_name)}</strong><br>
        <span class="muted">${esc(b.phone ?? "Sin teléfono")}${b.notes ? ` | ${esc(b.notes)}` : ""}</span>
      </div>
    `).join("") || "No hay clientes todavía.";
    document.querySelectorAll("[data-borrower-id]").forEach((el) => { el.onclick = () => window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: el.dataset.borrowerId } })); });
  }
  if (qs("loanBorrower")) qs("loanBorrower").innerHTML = (data ?? []).map((b) => `<option value="${esc(b.id)}">${esc(b.full_name)}</option>`).join("");
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
  if (!currentProfile || !["ADMIN", "AGENT", "PARTNER"].includes(currentProfile.role)) return alert("Tu cuenta no tiene permiso para agregar clientes.");
  const full_name = qs("bName")?.value.trim();
  if (!full_name) return alert("Nombre requerido.");
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("borrowers").insert({ full_name, phone: qs("bPhone")?.value.trim() || null, notes: qs("bNotes")?.value.trim() || null, created_by: userData.user.id });
  if (error) throw error;
  invalidatePageReads();
  qs("bName").value = ""; qs("bPhone").value = ""; qs("bNotes").value = "";
  await refreshBorrowers();
}
async function saveDefaultRates() {
  if (!["ADMIN", "AGENT", "PARTNER"].includes(currentProfile?.role)) return alert("Tu cuenta no tiene permiso para actualizar valores predeterminados.");
  const default_total_monthly_rate = Number(qs("defaultInterestRate")?.value || 0);
  const default_management_rate = Number(qs("defaultManagementRate")?.value || 0);
  if (!default_total_monthly_rate || default_management_rate < 0) return alert("Ingresa tasas válidas.");
  if (default_management_rate > default_total_monthly_rate) return alert("Administración no puede exceder el interés total.");
  await saveAppSetting("loan_defaults", { default_total_monthly_rate, default_management_rate });
  window.dispatchEvent(new CustomEvent('loan-ledger:rates-updated'));
  await prefillLoanDefaults(true);
  alert("Tasas predeterminadas guardadas.");
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
      await bootFromSession(session);
    } finally { btn.disabled = false; }
  });
  if (qs("btnGoogleSignIn")) qs("btnGoogleSignIn").onclick = safe(async () => {
    const btn = qs("btnGoogleSignIn");
    btn.disabled = true;
    try {
      setDebug("Abriendo Google...");
      const redirectUrl = new URL(window.location.href);
      redirectUrl.hash = "";
      redirectUrl.search = "";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl.toString(),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } finally { btn.disabled = false; }
  });
  if (qs("btnCheckAccess")) qs("btnCheckAccess").onclick = safe(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await bootFromSession(data.session);
  });
  if (qs("btnSwitchAccount")) qs("btnSwitchAccount").onclick = safe(async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  });
  if (qs("btnMagicLink")) qs("btnMagicLink").onclick = safe(async () => {
    const btn = qs("btnMagicLink");
    const email = qs("email")?.value.trim();
    if (!email) return alert("Ingresa tu correo electrónico.");
    btn.disabled = true;
    try {
      setDebug("Enviando enlace de acceso...");
      const redirectUrl = new URL(window.location.href);
      redirectUrl.hash = "";
      redirectUrl.search = "";
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectUrl.toString(),
        },
      });
      if (error) throw error;
      setDebug("Enlace enviado. Ábrelo desde tu correo para iniciar sesión en este dispositivo.");
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
  if (qs("btnSaveDefaultRates")) qs("btnSaveDefaultRates").onclick = safe(saveDefaultRates);
  if (qs('btnOpenPartnersSplit')) qs('btnOpenPartnersSplit').onclick = () => {openPage('partnersPage');window.dispatchEvent(new CustomEvent('loan-ledger:partners-tab',{detail:{tab:'split'}}));};
}
window.addEventListener('loan-ledger:defaults-updated',()=>prefillLoanDefaults(true).catch(error=>{if(!isStalePageSession(error))console.error(error);}));
window.addEventListener('loan-ledger:profile-updated',async()=>{
  const id=getPageSessionId();if(!id)return;
  try{const profile=await loadProfileByUserId(id);if(getPageSessionId()!==id||!profile)return;currentProfile=profile;
    if(qs('whoami'))qs('whoami').textContent=`${profile.full_name??'Usuario'} • ${roleName(profile.role)}`;
    if(qs('rolePill'))qs('rolePill').textContent=profile.role;
    syncAccessMenu();
    await refreshFundingPartnerSelects();
  }catch(error){if(!isStalePageSession(error))console.error(error);}
});
function syncAccessMenu() {
  const admin = currentProfile?.role === "ADMIN";
  const methods = qs("btnSignInMethods");
  const manage = qs("btnManageAppAccess");
  if (methods && methods.hidden === admin) methods.hidden = !admin;
  const owner = admin && getPageSessionId() === ACCESS_OWNER_ID;
  if (manage && manage.hidden === owner) manage.hidden = !owner;
}
async function setSignedInUI(profile) {
  currentProfile = profile;
  syncAccessMenu();
  qs("authCard").style.display = "none";
  qs("app").style.display = "block";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "inline-block";
  showThemeButton(true);
  if (qs("whoami")) qs("whoami").textContent = `${profile.full_name ?? "Usuario"} • ${roleName(profile.role)}`;
  if (qs("rolePill")) qs("rolePill").textContent = profile.role;
  ensureDefaultsButtons();
  initTabs();
  initHandlers();
  const pendingGoogleLink = sessionStorage.getItem("loanLedger.googleLinkPending");
  if (pendingGoogleLink) sessionStorage.removeItem("loanLedger.googleLinkPending");
  if (pendingGoogleLink === getPageSessionId()) openSignInMethods(undefined, true);
  qs("loanTotalRate") && (qs("loanTotalRate").oninput = updateLoanFunderRatePreview);
  qs("loanMgmtRate") && (qs("loanMgmtRate").oninput = updateLoanFunderRatePreview);
  await Promise.all([refreshBorrowers(), refreshFundingPartnerSelects(), loadDefaultsIntoSettingsUI(), prefillLoanDefaults(true)]);
  if (currentProfile === profile) setDebug("");
}
function setSignedOutUI() {
  setPageSession(null);
  currentProfile = null;
  if (qs("authCard")) qs("authCard").style.display = "block";
  if (qs("app")) qs("app").style.display = "none";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "none";
  syncAccessMenu();
  showThemeButton(false);
  if (qs("whoami")) qs("whoami").textContent = "Sesión no iniciada";
  if (qs("rolePill")) qs("rolePill").textContent = "rol";
  qs("authAccessActions").hidden = true;
  setDebug("");
}
function bootFromSession(session) {
  const user = session?.user;
  const userId = user?.id ?? null;
  if (activeAuthUser !== userId || !user) {
    authAttempt++;
    authBoot = null;
    activeAuthUser = userId;
    setSignedOutUI();
  }
  if (!user) {
    if (oauthError) setDebug("No se pudo completar el acceso con Google. Intenta de nuevo y elige el correo autorizado.");
    return;
  }
  if (currentProfile) return;
  if (authBoot) return authBoot;
  const attempt = ++authAttempt;
  setDebug("Verificando acceso...");
  authBoot = (async () => {
    try {
      const profile = await loadProfileByUserId(userId);
      if (attempt !== authAttempt) return;
      if (!profile) {
        setDebug(`Iniciaste sesión${user.email ? " como " + user.email : ""}, pero esta cuenta todavía no tiene acceso. Pide al administrador que le asigne un rol.`);
        qs("authAccessActions").hidden = false;
        return;
      }
      qs("authAccessActions").hidden = true;
      setPageSession(userId);
      await setSignedInUI(profile);
    } catch (error) {
      if (attempt !== authAttempt || isStalePageSession(error)) return;
      console.error("Could not load account", error);
      if (!currentProfile) {
        setDebug("No pudimos verificar tu acceso. Intenta de nuevo.");
        qs("authAccessActions").hidden = false;
      }
    } finally {
      if (attempt === authAttempt) authBoot = null;
    }
  })();
  return authBoot;
}
supabase.auth.onAuthStateChange((event, session) => {
  if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"].includes(event)) {
    setTimeout(() => bootFromSession(session), 0);
  }
});
initTabs();
initHandlers();
window.loanLedgerTheme?.initThemeButton?.();
document.addEventListener("click", event => {
  const admin = event.target.closest?.('[data-manage-app-access]');
  if (admin && getPageSessionId() === ACCESS_OWNER_ID && currentProfile?.role === "ADMIN") {
    closeMenu();
    openAdminAccess(supabase, admin);
    return;
  }
  const trigger = event.target.closest?.('[data-global-action="sign-in-methods"]');
  if (trigger) openSignInMethods(trigger);
});
