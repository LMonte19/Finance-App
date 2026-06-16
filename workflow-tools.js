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
let loanViewMode = localStorage.getItem("loanLedger.loanViewMode") || "borrower";
let defaultsLoadedOnce = false;
let groupedRenderInFlight = false;
let partnersRenderInFlight = false;

function activePage(id) {
  return qs(id)?.classList.contains("active-page");
}

function card(html, attrs = "") {
  return `<div class="workflow-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;cursor:default;">${html}</div>`;
}

function ensureStyles() {
  if (qs("workflowToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "workflowToolsStyle";
  style.textContent = `
    .workflow-button { cursor:pointer; transition:filter .15s ease, transform .05s ease; }
    .workflow-button:hover { filter:brightness(1.18); }
    .workflow-button:active { transform:scale(.98); }
    .workflow-button.active { background:#2b63ff !important; color:#fff !important; }
    .workflow-muted-button { background:#333 !important; }
    .workflow-card.clickable { cursor:pointer; }
    .workflow-card.clickable:hover { border-color:#52638f !important; }
    input, select, button { box-sizing:border-box; }
  `;
  document.head.appendChild(style);
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

function ensureLoanViewToggle() {
  const loanList = qs("loanList");
  if (!loanList || qs("loanViewToggle")) return;
  const wrap = document.createElement("div");
  wrap.id = "loanViewToggle";
  wrap.className = "card";
  wrap.innerHTML = `
    <div style="font-weight:800;">Loan View</div>
    <div class="row">
      <button id="btnLoanViewBorrower" class="workflow-button" type="button">By Borrower</button>
      <button id="btnLoanViewLoan" class="workflow-button workflow-muted-button" type="button">By Loan</button>
    </div>
  `;
  loanList.parentElement.insertBefore(wrap, loanList);

  qs("btnLoanViewBorrower").onclick = async () => {
    loanViewMode = "borrower";
    localStorage.setItem("loanLedger.loanViewMode", loanViewMode);
    await renderLoanView({ force: true });
  };
  qs("btnLoanViewLoan").onclick = async () => {
    loanViewMode = "loan";
    localStorage.setItem("loanLedger.loanViewMode", loanViewMode);
    await renderLoanView({ force: true });
  };
}

function updateLoanToggleButtons() {
  qs("btnLoanViewBorrower")?.classList.toggle("active", loanViewMode === "borrower");
  qs("btnLoanViewLoan")?.classList.toggle("active", loanViewMode === "loan");
}

async function renderLoanView({ force = false } = {}) {
  if (!activePage("loansPage") || !qs("loanList") || groupedRenderInFlight) return;
  if (!force && qs("loanList").dataset.workflowMode === loanViewMode) return;

  groupedRenderInFlight = true;
  try {
    updateLoanToggleButtons();
    if (loanViewMode === "borrower") await renderLoansByBorrower();
    else await renderLoansByLoan();
    qs("loanList").dataset.workflowMode = loanViewMode;
  } finally {
    groupedRenderInFlight = false;
  }
}

async function renderLoansByBorrower() {
  const [{ data: borrowers, error: borrowerErr }, { data: loans, error: loansErr }] = await Promise.all([
    supabase.from("borrower_loan_summary").select("*"),
    supabase.from("loans").select("id, borrower_id, start_date, principal_original, principal_outstanding, status, created_at").order("created_at", { ascending: false }),
  ]);
  if (borrowerErr) throw borrowerErr;
  if (loansErr) throw loansErr;

  const loansByBorrower = new Map();
  (loans ?? []).forEach((loan) => {
    if (!loansByBorrower.has(loan.borrower_id)) loansByBorrower.set(loan.borrower_id, []);
    loansByBorrower.get(loan.borrower_id).push(loan);
  });

  qs("loanList").innerHTML = (borrowers ?? []).length
    ? borrowers.map((b) => {
        const recentLoans = (loansByBorrower.get(b.borrower_id) ?? []).slice(0, 3);
        return card(`
          <strong>${b.full_name}</strong><br>
          <span class="muted">${b.phone || "No phone"}</span><br>
          <span class="muted">Loans: ${b.loan_count} | Active: ${b.active_loan_count} | Outstanding: ${money(b.total_outstanding)} | Original: ${money(b.total_original)}</span>
          <div style="margin-top:8px;">
            ${recentLoans.length ? recentLoans.map((l) => `
              <div style="padding:6px 0;border-top:1px solid #222;">
                <span class="muted">${l.start_date} | ${l.status} | Balance ${money(l.principal_outstanding)} | Original ${money(l.principal_original)}</span>
              </div>
            `).join("") : `<span class="muted">No loans yet.</span>`}
          </div>
          <div class="muted" style="margin-top:8px;">Click to open borrower details.</div>
        `, `data-workflow-borrower-card="1" data-borrower-id="${b.borrower_id}" class="clickable"`);
      }).join("")
    : "No borrowers yet.";

  document.querySelectorAll("[data-workflow-borrower-card]").forEach((el) => {
    el.onclick = () => openBorrowerDetailsLite(el.dataset.borrowerId);
  });
}

async function renderLoansByLoan() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, status, borrowers(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  qs("loanList").innerHTML = (data ?? []).length
    ? data.map((l) => card(`
        <strong>${l.borrowers?.full_name ?? "Unknown"}</strong><br>
        <span class="muted">Start: ${l.start_date} | ${l.status}</span><br>
        <span class="muted">Original: ${money(l.principal_original)} | Balance: ${money(l.principal_outstanding)}</span>
        <div class="muted" style="margin-top:8px;">Use borrower view for grouped details, or reopen this page after a hard refresh to use the original loan cards.</div>
      `, `data-loan-id="${l.id}"`)).join("")
    : "No loans yet.";
}

async function openBorrowerDetailsLite(borrowerId) {
  const [borrowerRes, loansRes, paymentsRes] = await Promise.all([
    supabase.from("borrowers").select("*").eq("id", borrowerId).single(),
    supabase.from("loans").select("id, start_date, principal_original, principal_outstanding, status").eq("borrower_id", borrowerId).order("created_at", { ascending: false }),
    supabase.from("payments").select("paid_on, amount, applied_interest, applied_principal, is_voided, notes").eq("borrower_id", borrowerId).order("paid_on", { ascending: false }),
  ]);

  if (borrowerRes.error) return alert(borrowerRes.error.message);
  if (loansRes.error) return alert(loansRes.error.message);
  if (paymentsRes.error) return alert(paymentsRes.error.message);

  const borrower = borrowerRes.data;
  const loans = loansRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.principal_original || 0), 0);
  const totalOutstanding = loans.reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
  const totalPaid = payments.filter((p) => !p.is_voided).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  qs("borrowerDetailsHeader").innerHTML = `
    <div><strong>Name:</strong> ${borrower.full_name}</div>
    <div><strong>Phone:</strong> ${borrower.phone ?? "—"}</div>
    <div><strong>Notes:</strong> ${borrower.notes ?? "—"}</div>
    <div><strong>Total Borrowed:</strong> ${money(totalBorrowed)}</div>
    <div><strong>Total Outstanding:</strong> ${money(totalOutstanding)}</div>
    <div><strong>Total Paid:</strong> ${money(totalPaid)}</div>
  `;

  qs("borrowerDetailsLoans").innerHTML = loans.length
    ? loans.map((l) => card(`<strong>${l.start_date}</strong><br><span class="muted">${l.status} | Original ${money(l.principal_original)} | Balance ${money(l.principal_outstanding)}</span>`)).join("")
    : "No loans yet.";

  qs("borrowerDetailsPayments").innerHTML = payments.length
    ? payments.map((p) => card(`<strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br><span class="muted">Interest ${money(p.applied_interest)} | Principal ${money(p.applied_principal)} ${p.notes ? `| ${p.notes}` : ""}</span>`)).join("")
    : "No payments yet.";

  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs("borrowerDetailsPage")?.classList.add("active-page");
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
    ensureDefaultsSaveHandler();
    await refreshDefaultsUI();
    if (activePage("loansPage")) {
      ensureLoanViewToggle();
      await renderLoanView();
    }
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
