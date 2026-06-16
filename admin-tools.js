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
let currentLoanId = null;
let currentProfile = null;
let adminRefreshTimer = null;

function activePage(id) {
  return qs(id)?.classList.contains("active-page");
}

function card(html) {
  return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:10px;margin:8px 0;box-sizing:border-box;">${html}</div>`;
}

function ensureStyles() {
  if (qs("adminToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "adminToolsStyle";
  style.textContent = `
    .admin-tools-button { cursor:pointer; transition:filter .15s ease, transform .05s ease; }
    .admin-tools-button:hover { filter:brightness(1.18); }
    .admin-tools-button:active { transform:scale(.98); }
    .admin-danger { background:#7a2b2b !important; }
    .admin-muted-btn { background:#333 !important; }
    .admin-mini-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    @media (max-width: 650px) { .admin-mini-grid { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);
}

async function getMyProfile() {
  if (currentProfile) return currentProfile;
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
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

function ensureAdminMenuItems() {
  const sideMenu = qs("sideMenu");
  if (!sideMenu) return;

  if (!qs("menuProfiles")) {
    const btn = document.createElement("button");
    btn.id = "menuProfiles";
    btn.className = "menu-link admin-tools-button";
    btn.textContent = "Profiles / Users";
    btn.onclick = async () => {
      ensurePage("profilesPage", "Profiles / Users");
      openPage("profilesPage");
      await refreshProfilesPage();
    };
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, defaultsBtn || null);
  }

  if (!qs("menuReports")) {
    const btn = document.createElement("button");
    btn.id = "menuReports";
    btn.className = "menu-link admin-tools-button";
    btn.textContent = "Reports / Export";
    btn.onclick = async () => {
      ensurePage("reportsPage", "Reports / Export");
      openPage("reportsPage");
      await refreshReportsPage();
    };
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, defaultsBtn || null);
  }

  if (!qs("menuMaintenance")) {
    const btn = document.createElement("button");
    btn.id = "menuMaintenance";
    btn.className = "menu-link admin-tools-button";
    btn.textContent = "Maintenance";
    btn.onclick = async () => {
      ensurePage("maintenancePage", "Maintenance");
      openPage("maintenancePage");
      await refreshMaintenancePage();
    };
    sideMenu.appendChild(btn);
  }
}

document.addEventListener("click", (event) => {
  const loanCard = event.target.closest("[data-loan-id]");
  if (loanCard?.dataset?.loanId) currentLoanId = loanCard.dataset.loanId;
});

async function refreshProfilesPage() {
  const profile = await getMyProfile();
  const content = qs("profilesPageContent");
  if (!content) return;

  const { data, error } = await supabase.from("profiles").select("user_id, full_name, role, created_at").order("created_at", { ascending: true });
  if (error) throw error;

  content.innerHTML = `
    ${profile?.role !== "ADMIN" ? `<div style="color:#ffd27a;">Only Admin can edit profile roles.</div>` : ""}
    ${(data ?? []).map((p) => card(`
      <div style="font-weight:800;">${p.full_name || "Unnamed"}</div>
      <div class="muted">${p.user_id}</div>
      <div class="admin-mini-grid" style="margin-top:8px;">
        <input data-profile-name="${p.user_id}" value="${p.full_name || ""}" placeholder="Display name" ${profile?.role === "ADMIN" ? "" : "disabled"} />
        <select data-profile-role="${p.user_id}" ${profile?.role === "ADMIN" ? "" : "disabled"}>
          ${["ADMIN", "AGENT", "PARTNER"].map((role) => `<option value="${role}" ${p.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </div>
      ${profile?.role === "ADMIN" ? `<button class="admin-tools-button" data-save-profile="${p.user_id}" type="button">Save Profile</button>` : ""}
    `)).join("") || "No profiles found."}
  `;

  document.querySelectorAll("[data-save-profile]").forEach((btn) => {
    btn.onclick = async () => {
      const userId = btn.dataset.saveProfile;
      const fullName = document.querySelector(`[data-profile-name="${userId}"]`)?.value || "";
      const role = document.querySelector(`[data-profile-role="${userId}"]`)?.value || "PARTNER";
      const { error } = await supabase.rpc("update_profile_admin", {
        p_user_id: userId,
        p_full_name: fullName,
        p_role: role,
      });
      if (error) return alert(error.message);
      currentProfile = null;
      await refreshProfilesPage();
      alert("Profile updated.");
    };
  });
}

async function injectLoanEdit() {
  if (!activePage("loanDetailsPage") || !currentLoanId || qs("loanEditBox")) return;
  const header = qs("loanDetailsHeader");
  if (!header) return;

  const profile = await getMyProfile();
  if (!profile || !["ADMIN", "AGENT"].includes(profile.role)) return;

  const { data: loan, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, monthly_rate_total, monthly_rate_mgmt, status")
    .eq("id", currentLoanId)
    .single();
  if (error) return;

  const box = document.createElement("div");
  box.id = "loanEditBox";
  box.className = "compact-card";
  box.style.background = "#0f0f11";
  box.style.border = "1px solid #2a2a2e";
  box.style.borderRadius = "12px";
  box.style.padding = "10px";
  box.style.marginTop = "12px";
  box.style.boxSizing = "border-box";
  box.innerHTML = `
    <div style="font-weight:800;">Edit Loan</div>
    <div class="muted">This edits loan-level info. Existing due rows keep their historical expected amounts.</div>
    <div class="admin-mini-grid" style="margin-top:8px;">
      <input id="editLoanStartDate" type="date" value="${loan.start_date || ""}" />
      <select id="editLoanStatus">
        ${["ACTIVE", "PAUSED", "DEFAULTED", "PAID_OFF"].map((s) => `<option value="${s}" ${loan.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <input id="editLoanOriginal" type="number" step="0.01" value="${Number(loan.principal_original || 0).toFixed(2)}" placeholder="Original principal" />
      <input id="editLoanOutstanding" type="number" step="0.01" value="${Number(loan.principal_outstanding || 0).toFixed(2)}" placeholder="Outstanding principal" />
      <input id="editLoanTotalRate" type="number" step="0.01" value="${(Number(loan.monthly_rate_total || 0) * 100).toFixed(2)}" placeholder="Total monthly interest %" />
      <input id="editLoanMgmtRate" type="number" step="0.01" value="${(Number(loan.monthly_rate_mgmt || 0) * 100).toFixed(2)}" placeholder="Management share %" />
    </div>
    <button id="btnSaveLoanEdit" class="admin-tools-button" type="button">Save Loan Changes</button>
  `;
  header.appendChild(box);

  qs("btnSaveLoanEdit").onclick = async () => {
    const { error: updateErr } = await supabase.rpc("update_loan_details", {
      p_loan_id: currentLoanId,
      p_start_date: qs("editLoanStartDate").value,
      p_principal_original: Number(qs("editLoanOriginal").value),
      p_principal_outstanding: Number(qs("editLoanOutstanding").value),
      p_monthly_rate_total: Number(qs("editLoanTotalRate").value) / 100,
      p_monthly_rate_mgmt: Number(qs("editLoanMgmtRate").value) / 100,
      p_status: qs("editLoanStatus").value,
    });
    if (updateErr) return alert(updateErr.message);
    alert("Loan updated. Reopen the loan to refresh all details.");
  };
}

function toCsv(rows) {
  if (!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  if (!csv) return alert("No data to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportView(viewName, filename) {
  const { data, error } = await supabase.from(viewName).select("*");
  if (error) return alert(error.message);
  downloadCsv(filename, data ?? []);
}

async function refreshReportsPage() {
  const content = qs("reportsPageContent");
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <div style="font-weight:800;">Export CSV Reports</div>
      <div class="muted">Downloads use the current database rows.</div>
      <button id="btnExportLoans" class="admin-tools-button" type="button">Export Loans CSV</button>
      <button id="btnExportBorrowers" class="admin-tools-button" type="button">Export Borrowers CSV</button>
      <button id="btnExportPayments" class="admin-tools-button" type="button">Export Payments CSV</button>
      <button id="btnExportPartners" class="admin-tools-button" type="button">Export Partner Earnings CSV</button>
    </div>
  `;

  qs("btnExportLoans").onclick = () => exportView("export_loans", "loan-ledger-loans.csv");
  qs("btnExportBorrowers").onclick = () => exportView("export_borrowers", "loan-ledger-borrowers.csv");
  qs("btnExportPayments").onclick = () => exportView("export_payments", "loan-ledger-payments.csv");
  qs("btnExportPartners").onclick = () => exportView("partner_earnings_summary", "loan-ledger-partner-earnings.csv");
}

async function refreshMaintenancePage() {
  const profile = await getMyProfile();
  const content = qs("maintenancePageContent");
  if (!content) return;

  content.innerHTML = `
    <div class="card">
      <div style="font-weight:800;">Reset Test Data</div>
      <div class="muted">This clears borrowers, loans, due events, payments, payment allocations, and funding splits. It keeps profiles and defaults/settings.</div>
      ${profile?.role === "ADMIN" ? `<button id="btnResetTestData" class="admin-tools-button admin-danger" type="button">Reset Test Data</button>` : `<div style="color:#ffd27a;">Only Admin can reset test data.</div>`}
    </div>
  `;

  const btn = qs("btnResetTestData");
  if (btn) {
    btn.onclick = async () => {
      const first = prompt("Type RESET to delete all test transaction data.");
      if (first !== "RESET") return alert("Reset cancelled.");
      const second = confirm("Final confirmation: delete all borrowers, loans, payments, due events, allocations, and funding splits?");
      if (!second) return;
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
    if (activePage("profilesPage")) await refreshProfilesPage();
    if (activePage("reportsPage")) await refreshReportsPage();
    if (activePage("maintenancePage")) await refreshMaintenancePage();
    if (activePage("loanDetailsPage")) await injectLoanEdit();
  } catch (error) {
    console.error(error);
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(adminRefreshTimer);
  adminRefreshTimer = setTimeout(refreshVisibleAdminTools, 200);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(refreshVisibleAdminTools, 3000);
refreshVisibleAdminTools();
