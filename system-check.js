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
let busy = false;
let lastHtml = "";

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

function statusColor(status) {
  if (status === "PASS") return "#9ff5b2";
  if (status === "WARN") return "#ffd27a";
  return "#ff8b8b";
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function ensureSystemCheckPage() {
  const app = qs("app");
  if (!app) return null;

  let page = qs("systemCheckPage");
  if (!page) {
    page = document.createElement("div");
    page.id = "systemCheckPage";
    page.className = "page";
    page.innerHTML = `
      <div class="card">
        <div style="font-weight:800;">System Check</div>
        <div class="muted">Readiness checks before using real data.</div>
        <button id="btnRefreshSystemCheck" type="button">Refresh Checks</button>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:800;">Check Results</div>
          <span class="pill" id="systemCheckCount">0</span>
        </div>
        <div id="systemCheckList" class="muted">Loading...</div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Role Permissions</div>
        <div id="rolePermissionList" class="muted">Loading...</div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Manual Test Checklist</div>
        <div id="manualChecklist" class="muted"></div>
      </div>
    `;
    app.appendChild(page);
  }

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuSystemCheck")) {
    const btn = document.createElement("button");
    btn.id = "menuSystemCheck";
    btn.className = "menu-link";
    btn.dataset.page = "systemCheckPage";
    btn.textContent = "System Check";
    const activityBtn = qs("menuActivity");
    const reportsBtn = qs("menuReports");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, activityBtn || reportsBtn || defaultsBtn || null);
  }

  const menuBtn = qs("menuSystemCheck");
  if (menuBtn && menuBtn.dataset.bound !== "true") {
    menuBtn.dataset.bound = "true";
    menuBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureSystemCheckPage();
      openPage("systemCheckPage");
      renderSystemCheck(true);
    };
  }

  const refreshBtn = qs("btnRefreshSystemCheck");
  if (refreshBtn && refreshBtn.dataset.bound !== "true") {
    refreshBtn.dataset.bound = "true";
    refreshBtn.onclick = () => renderSystemCheck(true);
  }

  return page;
}

function renderCheck(row) {
  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div>
        <strong>${row.summary}</strong><br>
        <span class="muted">${row.details || "—"}</span>
      </div>
      <span class="pill" style="color:${statusColor(row.status)};">${row.status}</span>
    </div>
    <div class="muted" style="margin-top:6px;">${row.check_code} | ${row.severity}</div>
  `);
}

function renderPermissions(rows) {
  const grouped = rows.reduce((acc, row) => {
    acc[row.role] ||= [];
    acc[row.role].push(row);
    return acc;
  }, {});

  return ["ADMIN", "AGENT", "PARTNER"].map((role) => {
    const list = grouped[role] || [];
    return card(`
      <strong>${role}</strong>
      ${list.map((row) => `
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px;">
          <span>${row.capability}</span>
          <span class="pill" style="color:${row.allowed ? "#9ff5b2" : "#ff8b8b"};">${row.allowed ? "YES" : "NO"}</span>
        </div>
      `).join("")}
    `);
  }).join("");
}

function manualChecklistHtml() {
  const items = [
    "Load dashboard and Command Center",
    "Create a borrower",
    "Create a loan with default rates and funding split",
    "Generate missing due dates",
    "Record a payment",
    "Open payment details and confirm split/allocation",
    "Void a payment as Admin only",
    "Open partner earnings page",
    "Add a follow-up",
    "Complete a follow-up",
    "Add a contact note",
    "Open Activity / History and confirm logs appear",
    "Export reports",
    "Sign in as Agent and confirm Admin-only buttons are hidden",
    "Sign in as Partner and confirm edit buttons are hidden",
  ];

  return items.map((item, index) => `
    <label style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;">
      <input type="checkbox" data-manual-check="${index}" style="width:auto;margin:2px 0 0 0;" />
      <span>${item}</span>
    </label>
  `).join("");
}

async function renderSystemCheck(force = false) {
  ensureSystemCheckPage();
  if (!isPage("systemCheckPage") || busy || !qs("systemCheckList")) return;

  busy = true;
  try {
    const [checksRes, permissionsRes] = await Promise.all([
      supabase.from("system_check_results").select("*").order("sort_order", { ascending: true }),
      supabase.from("role_permission_matrix").select("*").order("role", { ascending: true }).order("capability", { ascending: true }),
    ]);

    if (checksRes.error) throw checksRes.error;
    if (permissionsRes.error) throw permissionsRes.error;

    const checks = checksRes.data || [];
    const permissions = permissionsRes.data || [];
    const html = `${checks.map(renderCheck).join("")}---PERMS---${renderPermissions(permissions)}`;

    qs("systemCheckCount").textContent = `${checks.filter((c) => c.status !== "PASS").length} needs attention`;

    if (force || html !== lastHtml) {
      qs("systemCheckList").innerHTML = checks.length ? checks.map(renderCheck).join("") : "No system checks found.";
      qs("rolePermissionList").innerHTML = permissions.length ? renderPermissions(permissions) : "No permission matrix found.";
      qs("manualChecklist").innerHTML = manualChecklistHtml();
      lastHtml = html;
    }
  } catch (error) {
    console.error(error);
    qs("systemCheckList").innerHTML = error.message || String(error);
  } finally {
    busy = false;
  }
}

function tick() {
  ensureSystemCheckPage();
  if (isPage("systemCheckPage")) renderSystemCheck(false);
}

const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(tick, 200);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 3000);
tick();
