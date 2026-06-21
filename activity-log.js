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
let activityTimer = null;
let lastActivityHtml = "";
let activityBusy = false;

function isActivityPage() {
  return qs("activityPage")?.classList.contains("active-page");
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function prettyAction(action = "") {
  return String(action)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeText(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function activityPageHtml() {
  return `
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
}

function ensureActivityPage() {
  const app = qs("app");
  if (!app) return null;

  let page = qs("activityPage");
  if (!page) {
    page = document.createElement("div");
    page.id = "activityPage";
    page.className = "page";
    app.appendChild(page);
  }

  // Repair blank/generic versions created by older helper scripts.
  if (!qs("activityList") || !qs("activityFilterAction")) {
    page.innerHTML = activityPageHtml();
  }

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuActivity")) {
    const btn = document.createElement("button");
    btn.id = "menuActivity";
    btn.className = "menu-link";
    btn.dataset.page = "activityPage";
    btn.textContent = "Activity / History";

    const reportsBtn = qs("menuReports");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    if (reportsBtn) sideMenu.insertBefore(btn, reportsBtn);
    else sideMenu.insertBefore(btn, defaultsBtn || null);
  }

  const menuBtn = qs("menuActivity");
  if (menuBtn && menuBtn.dataset.activityBound !== "true") {
    menuBtn.dataset.activityBound = "true";
    menuBtn.dataset.page = "activityPage";
    menuBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureActivityPage();
      openPage("activityPage");
      renderActivity(true);
    };
  }

  if (qs("btnRefreshActivity") && qs("btnRefreshActivity").dataset.bound !== "true") {
    qs("btnRefreshActivity").dataset.bound = "true";
    qs("btnRefreshActivity").onclick = () => renderActivity(true);
    qs("activitySearch").oninput = () => renderActivity(false, true);
    qs("activityFilterAction").onchange = () => renderActivity(true);
    qs("activityFilterTable").onchange = () => renderActivity(true);
  }

  return page;
}

async function populateActionFilter(rows) {
  const sel = qs("activityFilterAction");
  if (!sel || sel.dataset.loaded === "true") return;

  const current = sel.value || "";
  const actions = [...new Set(rows.map((r) => r.action_type).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">All actions</option>${actions.map((a) => `<option value="${a}">${prettyAction(a)}</option>`).join("")}`;
  sel.value = current;
  sel.dataset.loaded = "true";
}

function rowMatchesFilters(row) {
  const action = qs("activityFilterAction")?.value || "";
  const table = qs("activityFilterTable")?.value || "";
  const term = String(qs("activitySearch")?.value || "").trim().toLowerCase();

  if (action && row.action_type !== action) return false;
  if (table && row.entity_table !== table) return false;

  if (term) {
    const haystack = [
      row.actor_name,
      row.actor_role,
      row.action_type,
      row.entity_table,
      row.entity_text,
      row.borrower_name,
      row.summary,
      row.loan_id,
      row.payment_id,
    ].map((x) => String(x || "").toLowerCase()).join(" ");
    if (!haystack.includes(term)) return false;
  }

  return true;
}

function changedFields(oldData = {}, newData = {}) {
  if (!oldData || !newData) return [];

  const ignored = new Set(["updated_at", "created_at"]);
  const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])]
    .filter((k) => !ignored.has(k));

  return keys
    .filter((key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]))
    .slice(0, 8)
    .map((key) => ({ key, before: oldData[key], after: newData[key] }));
}

function renderChangeSummary(row) {
  const oldData = row.old_data || null;
  const newData = row.new_data || null;

  if (!oldData && newData) {
    const interesting = ["full_name", "paid_on", "amount", "principal_original", "principal_outstanding", "status", "funding_percent", "setting_key", "role"];
    const lines = interesting
      .filter((k) => newData[k] !== undefined && newData[k] !== null)
      .map((k) => `<div><strong>${k}:</strong> ${safeText(newData[k])}</div>`)
      .join("");
    return lines || "";
  }

  if (oldData && !newData) {
    return `<div><strong>Deleted:</strong> ${safeText(row.summary)}</div>`;
  }

  const changes = changedFields(oldData, newData);
  if (!changes.length) return "";

  return changes.map((c) => `
    <div>
      <strong>${c.key}:</strong>
      <span class="muted">${safeText(c.before)}</span>
      →
      <span>${safeText(c.after)}</span>
    </div>
  `).join("");
}

function renderRow(row) {
  const action = prettyAction(row.action_type);
  const entity = row.borrower_name
    || row.entity_text
    || (row.payment_id ? `Payment ${String(row.payment_id).slice(0, 8)}` : "")
    || (row.loan_id ? `Loan ${String(row.loan_id).slice(0, 8)}` : "")
    || row.entity_table;

  const amountLine = row.payment_amount != null
    ? `<span class="muted">Payment: ${money(row.payment_amount)} ${row.payment_paid_on ? `on ${row.payment_paid_on}` : ""}</span><br>`
    : "";

  const changes = renderChangeSummary(row);

  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div>
        <strong>${action}</strong><br>
        <span class="muted">${fmtDate(row.created_at)} | ${row.actor_name || "System"}${row.actor_role ? ` (${row.actor_role})` : ""}</span>
      </div>
      <span class="pill">${row.entity_table}</span>
    </div>
    <div style="margin-top:8px;">
      <strong>${entity}</strong><br>
      <span class="muted">${row.summary || "—"}</span><br>
      ${amountLine}
      ${changes ? `<div style="margin-top:8px;">${changes}</div>` : ""}
    </div>
  `);
}

async function renderActivity(force = false, localOnly = false) {
  ensureActivityPage();
  if (!isActivityPage() || activityBusy || !qs("activityList")) return;

  if (localOnly) {
    document.querySelectorAll("#activityList .compact-card").forEach((el) => {
      const term = String(qs("activitySearch")?.value || "").trim().toLowerCase();
      el.style.display = !term || el.textContent.toLowerCase().includes(term) ? "" : "none";
    });
    return;
  }

  const stamp = `${qs("activityFilterAction")?.value || ""}:${qs("activityFilterTable")?.value || ""}`;
  if (!force && qs("activityList").dataset.stamp === stamp && lastActivityHtml) return;

  activityBusy = true;
  try {
    const { data, error } = await supabase
      .from("activity_log_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) throw error;

    await populateActionFilter(data || []);

    const rows = (data || []).filter(rowMatchesFilters);
    const html = rows.length ? rows.map(renderRow).join("") : "No activity found for this view.";

    qs("activityList").dataset.stamp = stamp;
    qs("activityCountPill").textContent = String(rows.length);

    if (force || html !== lastActivityHtml) {
      qs("activityList").innerHTML = html;
      lastActivityHtml = html;
    }
  } catch (error) {
    console.error(error);
    qs("activityList").innerHTML = error.message || String(error);
  } finally {
    activityBusy = false;
  }
}

async function tick() {
  ensureActivityPage();
  if (isActivityPage()) await renderActivity();
}

const observer = new MutationObserver(() => {
  clearTimeout(activityTimer);
  activityTimer = setTimeout(tick, 200);
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2500);
tick();
