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
let busy = false;

function isDefaultsPage() {
  return qs("defaultsPage")?.classList.contains("active-page");
}

function isLoansPage() {
  return qs("loansPage")?.classList.contains("active-page");
}

function roundPct(n) {
  return `${(Number(n || 0) * 100).toFixed(2)}%`;
}

async function loadSetting(key) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.setting_value ?? null;
}

async function saveSetting(key, value) {
  const { error } = await supabase.rpc("set_app_setting", { p_key: key, p_value: value });
  if (error) throw error;
}

function fundingTotal(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
}

function splitWarning(total) {
  if (Math.abs(total - 1) <= 0.001) return `<div style="color:#87e39a;margin-top:8px;">Default split totals 100%.</div>`;
  if (total > 1) return `<div style="color:#ff8b8b;margin-top:8px;">Warning: default split exceeds 100%.</div>`;
  return `<div style="color:#ffd27a;margin-top:8px;">Warning: default split is below 100%.</div>`;
}

async function renderEnhancedDefaults(force = false) {
  if (!isDefaultsPage() || busy || !qs("defaultFundingList")) return;
  const stamp = `${Date.now() - (Date.now() % 3000)}`;
  if (!force && qs("defaultFundingList").dataset.enhancedStamp === stamp) return;

  busy = true;
  try {
    const [rates, funding] = await Promise.all([
      loadSetting("loan_defaults"),
      loadSetting("default_funding_split"),
    ]);

    const rows = Array.isArray(funding) ? funding : [];
    const total = fundingTotal(rows);

    if (qs("defaultInterestRate") && !document.activeElement?.isSameNode(qs("defaultInterestRate"))) {
      qs("defaultInterestRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
    }
    if (qs("defaultManagementRate") && !document.activeElement?.isSameNode(qs("defaultManagementRate"))) {
      qs("defaultManagementRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
    }

    qs("defaultFundingList").dataset.enhancedStamp = stamp;
    qs("defaultFundingList").innerHTML = rows.length ? `
      ${rows.map((row) => `
        <div class="compact-card" data-default-split-row="${row.partner_user_id}" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;">
          <div>
            <strong>${row.partner_name || "Unknown partner"}</strong><br>
            <span class="muted">${roundPct(row.funding_percent)}</span>
          </div>
          <button type="button" data-remove-default-split="${row.partner_user_id}" style="width:auto;background:#7a2b2b;padding:10px 14px;">Remove</button>
        </div>
      `).join("")}
      <div style="margin-top:10px;"><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
      ${splitWarning(total)}
    ` : "No default funding split saved yet.";

    document.querySelectorAll("[data-remove-default-split]").forEach((btn) => {
      btn.onclick = async () => {
        const partnerId = btn.dataset.removeDefaultSplit;
        const current = await loadSetting("default_funding_split") || [];
        const next = current.filter((row) => row.partner_user_id !== partnerId);
        await saveSetting("default_funding_split", next);
        await renderEnhancedDefaults(true);
        alert("Default split row removed.");
      };
    });
  } catch (error) {
    console.error(error);
  } finally {
    busy = false;
  }
}

function parseNewLoanSplitTotal() {
  const text = qs("newLoanFundingList")?.textContent || "";
  const match = text.match(/Total:\s*([0-9.]+)%/i);
  if (!match) return null;
  return Number(match[1]);
}

function validationMessage() {
  const usingNewBorrower = qs("newBorrowerFields") && qs("newBorrowerFields").style.display !== "none";
  const borrowerId = qs("loanBorrower")?.value;
  const newBorrowerName = qs("newBorrowerName")?.value.trim();
  const principal = Number(qs("principal")?.value || 0);
  const startDate = qs("startDate")?.value;
  const totalRate = Number(qs("loanTotalRate")?.value || 0);
  const mgmtRate = Number(qs("loanMgmtRate")?.value || 0);
  const splitTotal = parseNewLoanSplitTotal();

  if (usingNewBorrower && !newBorrowerName) return "Enter the new borrower name.";
  if (!usingNewBorrower && !borrowerId) return "Select a borrower or use + New Borrower.";
  if (!principal || principal <= 0) return "Enter a principal amount greater than 0.";
  if (!startDate) return "Choose a start date.";
  if (!totalRate || totalRate <= 0) return "Enter the total monthly interest percent.";
  if (mgmtRate < 0) return "Management share cannot be negative.";
  if (mgmtRate > totalRate) return "Management share cannot be higher than total monthly interest.";
  if (splitTotal == null) return "Add at least one funding split.";
  if (Math.abs(splitTotal - 100) > 0.1) return `Funding split must total 100%. Current total: ${splitTotal.toFixed(2)}%.`;
  return "Ready to save.";
}

function ensureLoanValidationBox() {
  const btn = qs("btnCreateLoan");
  if (!btn || qs("loanValidationStatus")) return;
  const box = document.createElement("div");
  box.id = "loanValidationStatus";
  box.className = "muted";
  box.style.marginTop = "8px";
  btn.insertAdjacentElement("beforebegin", box);
}

function refreshLoanValidationMessage() {
  if (!isLoansPage() || !qs("loanValidationStatus")) return;
  const msg = validationMessage();
  const el = qs("loanValidationStatus");
  el.textContent = msg;
  el.style.color = msg === "Ready to save." ? "#87e39a" : "#ffd27a";
}

function setupLoanValidationGuard() {
  if (document.body.dataset.loanValidationGuard === "true") return;
  document.body.dataset.loanValidationGuard = "true";

  document.addEventListener("input", () => setTimeout(refreshLoanValidationMessage, 50), true);
  document.addEventListener("change", () => setTimeout(refreshLoanValidationMessage, 50), true);

  document.addEventListener("click", (event) => {
    if (event.target?.id !== "btnCreateLoan") return;
    const msg = validationMessage();
    if (msg !== "Ready to save.") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      alert(msg);
    }
  }, true);
}

async function tick() {
  setupLoanValidationGuard();
  if (isDefaultsPage()) await renderEnhancedDefaults();
  if (isLoansPage()) {
    ensureLoanValidationBox();
    refreshLoanValidationMessage();
  }
}

const observer = new MutationObserver(() => setTimeout(tick, 150));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(tick, 1000);
tick();
