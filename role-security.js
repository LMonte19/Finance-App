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

const ADMIN_ONLY_IDS = new Set([
  "btnVoidLoan",
  "btnVoidPaymentDetail",
  "btnSaveLoanActionEdit",
  "btnMarkPaidOff",
  "btnCloseLoan",
  "btnAddFundingSplit",
  "btnSaveDefaultFunding",
  "btnResetTestData",
  "btnSavePaymentNotesAdminOnly",
]);

const AGENT_ALLOWED_ACTION_IDS = new Set([
  "btnAddBorrower",
  "btnCreateLoan",
  "btnAddPayment",
  "btnToggleNewBorrower",
  "btnAddNewLoanFunding",
  "btnAddFollowup",
  "btnAddContactLog",
  "btnBorrowerSaveContact",
  "btnBorrowerAddFollowup",
  "btnGenerateAllDue",
  "quickGenerateDue",
]);

const PARTNER_BLOCKED_IDS = new Set([
  "btnAddBorrower",
  "btnCreateLoan",
  "btnAddPayment",
  "btnToggleNewBorrower",
  "btnAddNewLoanFunding",
  "btnAddFundingSplit",
  "btnSaveDefaultFunding",
  "btnResetTestData",
  "btnSaveLoanActionEdit",
  "btnMarkPaidOff",
  "btnCloseLoan",
  "btnVoidLoan",
  "btnVoidPaymentDetail",
  "btnAddFollowup",
  "btnAddContactLog",
  "btnBorrowerSaveContact",
  "btnBorrowerAddFollowup",
  "btnGenerateAllDue",
  "quickNewLoan",
  "quickRecordPayment",
  "quickFollowup",
  "quickLogContact",
  "quickGenerateDue",
]);

function hideElement(el, reason = "Not available for this role") {
  if (!el) return;
  el.dataset.roleHidden = "true";
  el.title = reason;
  el.style.display = "none";
}

function disableElement(el, reason = "Not available for this role") {
  if (!el) return;
  el.disabled = true;
  el.title = reason;
  el.style.opacity = "0.5";
  el.style.cursor = "not-allowed";
}

function showElement(el) {
  if (!el || el.dataset.roleHidden !== "true") return;
  el.style.display = "";
  delete el.dataset.roleHidden;
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
  currentName = data?.full_name || user.email || "User";
  return data;
}

function hideMenuForRole() {
  if (!currentRole) return;

  const adminMenuIds = ["menuProfiles", "menuMaintenance"];
  const settingsMenu = document.querySelector('[data-page="defaultsPage"]');

  if (currentRole !== "ADMIN") {
    adminMenuIds.forEach((id) => hideElement(qs(id), "Admin only"));
    hideElement(settingsMenu, "Admin only");
  } else {
    adminMenuIds.forEach((id) => showElement(qs(id)));
    showElement(settingsMenu);
  }

  if (currentRole === "PARTNER") {
    hideElement(qs("menuLoanHealth"), "Admin/Agent only");
    hideElement(qs("menuFollowups"), "Admin/Agent only");
    hideElement(qs("menuDueOverdue"), "Admin/Agent only");
  } else {
    showElement(qs("menuLoanHealth"));
    showElement(qs("menuFollowups"));
    showElement(qs("menuDueOverdue"));
  }
}

function protectButtons() {
  if (!currentRole) return;

  document.querySelectorAll("button").forEach((btn) => {
    const id = btn.id || "";
    const text = (btn.textContent || "").trim().toLowerCase();

    if (currentRole !== "ADMIN" && ADMIN_ONLY_IDS.has(id)) {
      hideElement(btn, "Admin only");
      return;
    }

    if (currentRole !== "ADMIN" && btn.dataset.quickVoidPayment) {
      hideElement(btn, "Admin only");
      return;
    }

    if (currentRole !== "ADMIN" && /void payment|void loan|reset test data|save profile|save funding split/i.test(btn.textContent || "")) {
      hideElement(btn, "Admin only");
      return;
    }

    if (currentRole === "PARTNER" && PARTNER_BLOCKED_IDS.has(id)) {
      hideElement(btn, "Partner is view-only");
      return;
    }

    if (currentRole === "PARTNER" && /(save|add|create|record|generate|mark done|close|void|reset)/i.test(text)) {
      hideElement(btn, "Partner is view-only");
      return;
    }
  });
}

function protectInputs() {
  if (!currentRole) return;

  if (currentRole === "PARTNER") {
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const allowSearch = /search|filter/i.test(el.id || "") || /search/i.test(el.placeholder || "");
      if (!allowSearch) disableElement(el, "Partner is view-only");
    });
  }

  if (currentRole !== "ADMIN") {
    document.querySelectorAll("#defaultInterestRate,#defaultManagementRate,#defaultFundingPartner,#defaultFundingPercent,#fundingPartner,#fundingPercent,#actionLoanStartDate,#actionLoanStatus,#actionLoanOriginal,#actionLoanOutstanding,#actionLoanTotalRate,#actionLoanMgmtRate,#actionLoanNotes").forEach((el) => {
      disableElement(el, "Admin only");
    });
  }
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
        <strong>Signed in as ${currentName || "User"}</strong><br>
        <span class="muted">Role: ${currentRole}</span>
      </div>
      <span class="pill">Permissions active</span>
    </div>
  `;
  app.insertBefore(banner, app.firstChild);
}

async function applyRoleGuards() {
  try {
    if (!currentRole) await loadCurrentProfile();
    if (!currentRole) return;

    addRoleBanner();
    hideMenuForRole();
    protectButtons();
    protectInputs();
  } catch (error) {
    console.error("Role guard error:", error);
  }
}

supabase.auth.onAuthStateChange(() => {
  currentRole = null;
  currentName = null;
  setTimeout(applyRoleGuards, 500);
});

const observer = new MutationObserver(() => {
  clearTimeout(guardTimer);
  guardTimer = setTimeout(applyRoleGuards, 150);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(applyRoleGuards, 2000);
applyRoleGuards();
