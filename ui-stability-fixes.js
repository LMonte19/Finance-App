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
let timer = null;
let activityBusy = false;

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function isPage(id) {
  return qs(id)?.classList.contains("active-page");
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function prettyAction(action = "") {
  return String(action)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function card(html) {
  return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function ensureActivityPageDom() {
  const app = qs("app");
  if (!app) return;

  if (!qs("activityPage")) {
    const page = document.createElement("div");
    page.id = "activityPage";
    page.className = "page";
    page.innerHTML = `
      <div class="card">
        <div style="font-weight:800;">Activity / History</div>
        <div class="muted">Shows edits, voids, status changes, settings changes, and other tracked actions.</div>
        <div class="row" style="margin-top:10px;">
          <select id="activityFilterAction"><option value="">All actions</option></select>
          <select id="activityFilterTable">
            <option value="">All sections</option>
            <option value="borrowers">Borrowers</option>
            <option value="loans">Loans</option>
            <option value="payments">Payments</option>
            <option value="loan_funding">Funding Splits</option>
            <option value="default_funding_splits">Default Splits</option>
            <option value="app_settings">Settings</option>
            <option value="profiles">Profiles</option>
          </select>
        </div>
        <div class="row">
          <input id="activitySearch" placeholder="Search user, borrower, action, summary..." />
          <button id="btnRefreshActivity" type="button">Refresh</button>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:800;">Recent Activity</div>
          <span class="pill" id="activityCountPill">0</span>
        </div>
        <div id="activityList" class="muted">Loading...</div>
      </div>
    `;
    app.appendChild(page);
  }

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuActivity")) {
    const btn = document.createElement("button");
    btn.id = "menuActivity";
    btn.className = "menu-link";
    btn.textContent = "Activity / History";
    const reportsBtn = qs("menuReports");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    if (reportsBtn) sideMenu.insertBefore(btn, reportsBtn);
    else sideMenu.insertBefore(btn, defaultsBtn || null);
  }

  const btn = qs("menuActivity");
  if (btn && btn.dataset.stabilityPatched !== "true") {
    btn.dataset.stabilityPatched = "true";
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureActivityPageDom();
      openPage("activityPage");
      renderActivityFix(true);
    };
  }

  const refreshBtn = qs("btnRefreshActivity");
  if (refreshBtn && refreshBtn.dataset.stabilityPatched !== "true") {
    refreshBtn.dataset.stabilityPatched = "true";
    refreshBtn.onclick = () => renderActivityFix(true);
  }

  const search = qs("activitySearch");
  if (search && search.dataset.stabilityPatched !== "true") {
    search.dataset.stabilityPatched = "true";
    search.oninput = () => renderActivityFix(true);
  }

  const action = qs("activityFilterAction");
  if (action && action.dataset.stabilityPatched !== "true") {
    action.dataset.stabilityPatched = "true";
    action.onchange = () => renderActivityFix(true);
  }

  const table = qs("activityFilterTable");
  if (table && table.dataset.stabilityPatched !== "true") {
    table.dataset.stabilityPatched = "true";
    table.onchange = () => renderActivityFix(true);
  }
}

async function renderActivityFix(force = false) {
  ensureActivityPageDom();
  if (!isPage("activityPage") || activityBusy || !qs("activityList")) return;

  activityBusy = true;
  try {
    const { data, error } = await supabase
      .from("activity_log_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) throw error;

    const actionFilter = qs("activityFilterAction")?.value || "";
    const tableFilter = qs("activityFilterTable")?.value || "";
    const term = String(qs("activitySearch")?.value || "").trim().toLowerCase();

    const actionSelect = qs("activityFilterAction");
    if (actionSelect && actionSelect.dataset.optionsLoaded !== "true") {
      const actions = [...new Set((data || []).map((r) => r.action_type).filter(Boolean))].sort();
      actionSelect.innerHTML = `<option value="">All actions</option>${actions.map((a) => `<option value="${a}">${prettyAction(a)}</option>`).join("")}`;
      actionSelect.value = actionFilter;
      actionSelect.dataset.optionsLoaded = "true";
    }

    const rows = (data || []).filter((row) => {
      if (actionFilter && row.action_type !== actionFilter) return false;
      if (tableFilter && row.entity_table !== tableFilter) return false;
      if (term) {
        const haystack = [
          row.actor_name,
          row.actor_role,
          row.action_type,
          row.entity_table,
          row.borrower_name,
          row.summary,
          row.loan_id,
          row.payment_id,
          row.entity_text,
        ].map((x) => String(x || "").toLowerCase()).join(" ");
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    qs("activityCountPill").textContent = String(rows.length);
    qs("activityList").innerHTML = rows.length
      ? rows.map((row) => {
          const entity = row.borrower_name
            || row.entity_text
            || (row.payment_id ? `Payment ${String(row.payment_id).slice(0, 8)}` : "")
            || (row.loan_id ? `Loan ${String(row.loan_id).slice(0, 8)}` : "")
            || row.entity_table;

          const paymentLine = row.payment_amount != null
            ? `<br><span class="muted">Payment: ${money(row.payment_amount)} ${row.payment_paid_on ? `on ${row.payment_paid_on}` : ""}</span>`
            : "";

          return card(`
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
              <div>
                <strong>${prettyAction(row.action_type)}</strong><br>
                <span class="muted">${formatDate(row.created_at)} | ${row.actor_name || "System"}${row.actor_role ? ` (${row.actor_role})` : ""}</span>
              </div>
              <span class="pill">${row.entity_table}</span>
            </div>
            <div style="margin-top:8px;">
              <strong>${entity}</strong><br>
              <span class="muted">${row.summary || "—"}</span>${paymentLine}
            </div>
          `);
        }).join("")
      : "No activity found for this view.";
  } catch (error) {
    console.error(error);
    qs("activityList").innerHTML = error.message || String(error);
  } finally {
    activityBusy = false;
  }
}

function stabilizePaymentsList() {
  if (!isPage("paymentsPage")) return;

  const list = qs("paymentList");
  if (!list) return;

  const isDetail = list.textContent.includes("Payment Details");
  if (isDetail) return;

  const hasNewCards = !!list.querySelector("[data-payment-id]");
  const looksLikeLegacyCompact =
    !hasNewCards &&
    list.textContent.includes("Interest $") &&
    list.textContent.includes("Principal $") &&
    !list.textContent.includes("Click for details");

  const looksLikeMainAppCompact =
    !hasNewCards &&
    list.textContent.includes("Interest $") &&
    list.textContent.includes("Principal $") &&
    list.children.length === 0;

  if (!looksLikeLegacyCompact && !looksLikeMainAppCompact) return;
  if (list.dataset.stabilizing === "true") return;

  list.dataset.stabilizing = "true";
  list.dataset.paymentStamp = "legacy-overwrite";

  const filter = localStorage.getItem("loanLedger.paymentFilter") || "active";
  const buttonByFilter = {
    active: "payFilterActive",
    all: "payFilterAll",
    voided: "payFilterVoided",
    month: "payFilterMonth",
  };

  setTimeout(() => {
    const btn = qs(buttonByFilter[filter] || "payFilterActive");
    if (btn) btn.click();
    list.dataset.stabilizing = "";
  }, 80);
}

function tick() {
  ensureActivityPageDom();
  if (isPage("activityPage")) renderActivityFix(false);
  stabilizePaymentsList();
}

const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(tick, 120);
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 800);
tick();
