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
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
let workflowTimer = null;
let defaultsLoadedOnce = false;
let partnersRenderInFlight = false;

function activePage(id) {
  return qs(id)?.classList.contains("active-page");
}

function card(html) {
  return `<div class="workflow-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function ensureStyles() {
  if (qs("workflowToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "workflowToolsStyle";
  style.textContent = `
    .workflow-button { cursor:pointer; transition:filter .15s ease, transform .05s ease; }
    .workflow-button:hover { filter:brightness(1.18); }
    .workflow-button:active { transform:scale(.98); }
    input, select, button { box-sizing:border-box; }
  `;
  document.head.appendChild(style);
}

function removeDuplicateLoanViewCard() {
  // The main app already has the better By Borrower / By Loan toggle.
  // This removes the temporary duplicate card from the previous workflow extension.
  qs("loanViewToggle")?.remove();
}

async function getProfilesMap() {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, role")
    .in("role", ["ADMIN", "PARTNER"])
    .order("full_name", { ascending: true });
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [p.user_id, p]));
}

async function loadLoanDefaults() {
  const [{ data: setting }, { data: splits }, profilesMap] = await Promise.all([
    supabase.from("app_settings").select("setting_value").eq("setting_key", "loan_defaults").maybeSingle(),
    supabase.from("default_funding_splits").select("partner_user_id, funding_percent").order("created_at", { ascending: true }),
    getProfilesMap(),
  ]);

  const defaults = setting?.setting_value || { monthly_rate_total: 0.10, monthly_rate_mgmt: 0.03 };
  const rows = (splits ?? []).map((s) => ({
    partner_user_id: s.partner_user_id,
    funding_percent: Number(s.funding_percent || 0),
    partner_name: profilesMap[s.partner_user_id]?.full_name || "Unknown",
    role: profilesMap[s.partner_user_id]?.role || "PARTNER",
  }));

  return { defaults, rows };
}

function renderDefaultFundingList(rows) {
  const el = qs("defaultFundingList");
  if (!el) return;

  const total = rows.reduce((sum, r) => sum + Number(r.funding_percent || 0), 0);
  el.innerHTML = rows.length
    ? `
      ${rows.map((r) => `
        <div data-partner-id="${r.partner_user_id}" data-percent="${r.funding_percent}" data-partner-name="${r.partner_name}" style="margin-bottom:10px;">
          <strong>${r.partner_name}</strong> <span class="muted">(${r.role})</span><br>
          <span class="muted">${(r.funding_percent * 100).toFixed(2)}%</span>
        </div>
      `).join("")}
      <div><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
      ${total < 0.999 || total > 1.001 ? `<div style="color:#ffd27a;margin-top:8px;">Default split should total 100% before using real data.</div>` : ""}
    `
    : "No default funding split saved yet.";
}

function applyDefaultsToNewLoanForm(defaults, rows) {
  const totalRate = Number(defaults.monthly_rate_total ?? 0.10) * 100;
  const mgmtRate = Number(defaults.monthly_rate_mgmt ?? 0.03) * 100;

  if (qs("defaultInterestRate")) qs("defaultInterestRate").value = totalRate.toFixed(2).replace(/\.00$/, "");
  if (qs("defaultManagementRate")) qs("defaultManagementRate").value = mgmtRate.toFixed(2).replace(/\.00$/, "");

  if (qs("loanTotalRate") && !qs("loanTotalRate").value) qs("loanTotalRate").value = totalRate.toFixed(2).replace(/\.00$/, "");
  if (qs("loanMgmtRate") && !qs("loanMgmtRate").value) qs("loanMgmtRate").value = mgmtRate.toFixed(2).replace(/\.00$/, "");

  qs("loanTotalRate")?.dispatchEvent(new Event("input", { bubbles: true }));
  qs("loanMgmtRate")?.dispatchEvent(new Event("input", { bubbles: true }));

  const list = qs("newLoanFundingList");
  const partnerSelect = qs("newLoanFundingPartner");
  const percentInput = qs("newLoanFundingPercent");
  const addBtn = qs("btnAddNewLoanFunding");

  if (!list || !partnerSelect || !percentInput || !addBtn || !rows.length) return;

  const alreadyHasSplit = list.textContent && !/No funding split/i.test(list.textContent);
  if (alreadyHasSplit) return;

  rows.forEach((r) => {
    partnerSelect.value = r.partner_user_id;
    percentInput.value = (r.funding_percent * 100).toFixed(2).replace(/\.00$/, "");
    addBtn.click();
  });
}

async function refreshDefaultsUI({ force = false } = {}) {
  if (!qs("defaultInterestRate") && !qs("loanTotalRate")) return;
  if (defaultsLoadedOnce && !force) return;

  const { defaults, rows } = await loadLoanDefaults();
  renderDefaultFundingList(rows);
  applyDefaultsToNewLoanForm(defaults, rows);
  defaultsLoadedOnce = true;
}

function ensureDefaultsSaveHandler() {
  const btn = qs("btnSaveDefaultFunding");
  if (!btn || btn.dataset.workflowReady === "true") return;
  btn.dataset.workflowReady = "true";
  btn.classList.add("workflow-button");

  btn.onclick = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const totalRate = Number(qs("defaultInterestRate")?.value || 10) / 100;
      const mgmtRate = Number(qs("defaultManagementRate")?.value || 3) / 100;
      if (mgmtRate > totalRate) return alert("Management share cannot be higher than total monthly interest.");

      const { error: settingErr } = await supabase.from("app_settings").upsert({
        setting_key: "loan_defaults",
        setting_value: {
          monthly_rate_total: totalRate,
          monthly_rate_mgmt: mgmtRate,
        },
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }, { onConflict: "setting_key" });
      if (settingErr) throw settingErr;

      const partnerId = qs("defaultFundingPartner")?.value;
      const percent = Number(qs("defaultFundingPercent")?.value || 0);
      if (partnerId && percent > 0) {
        const { error: splitErr } = await supabase.from("default_funding_splits").upsert({
          partner_user_id: partnerId,
          funding_percent: percent / 100,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: "partner_user_id" });
        if (splitErr) throw splitErr;
        qs("defaultFundingPercent").value = "";
      }

      defaultsLoadedOnce = false;
      await refreshDefaultsUI({ force: true });
      alert("Defaults saved.");
    } catch (error) {
      console.error(error);
      alert(error.message || String(error));
    }
  };
}

async function renderPartnersPage({ force = false } = {}) {
  if (!activePage("partnersPage") || !qs("partnersPage") || partnersRenderInFlight) return;
  const page = qs("partnersPage");
  if (!force && page.dataset.workflowLoaded === "true") return;

  partnersRenderInFlight = true;
  try {
    const { data, error } = await supabase.from("partner_earnings_summary").select("*");
    if (error) throw error;

    page.dataset.workflowLoaded = "true";
    page.innerHTML = `
      <div class="card">
        <div style="font-weight:800;">Partner Earnings</div>
        <div class="muted">Based on non-voided payment allocations.</div>
        ${(data ?? []).length ? (data ?? []).map((p) => card(`
          <strong>${p.partner_name || "Unnamed"}</strong> <span class="muted">(${p.role})</span><br>
          <span class="muted">Total earned: ${money(p.total_earned)} | Management: ${money(p.management_earned)} | Funders: ${money(p.funder_earned)} | Allocations: ${p.allocation_count ?? 0}</span>
        `)).join("") : "No partner earnings yet."}
      </div>
    `;
  } finally {
    partnersRenderInFlight = false;
  }
}

async function refreshWorkflowEnhancements() {
  try {
    ensureStyles();
    removeDuplicateLoanViewCard();
    ensureDefaultsSaveHandler();
    await refreshDefaultsUI();
    if (activePage("partnersPage")) await renderPartnersPage();
  } catch (error) {
    console.error(error);
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(workflowTimer);
  workflowTimer = setTimeout(refreshWorkflowEnhancements, 250);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(refreshWorkflowEnhancements, 2500);
refreshWorkflowEnhancements();
