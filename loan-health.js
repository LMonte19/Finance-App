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
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
let healthTimer = null;
let healthBusy = false;
let lastHealthHtml = "";

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

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function severityColor(severity) {
  if (severity === "HIGH") return "#ff8b8b";
  if (severity === "MEDIUM") return "#ffd27a";
  return "#8fb1ff";
}

function prettyCode(code = "") {
  return String(code).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function loanHealthHtml() {
  return `
    <div class="card">
      <div style="font-weight:800;">Loan Health / Due Schedule</div>
      <div class="muted">Checks active loans, future due dates, funding splits, and due-row consistency.</div>
      <div class="stats-grid" style="margin-top:12px;">
        <div class="stat-card"><div class="stat-label">Total Issues</div><div class="stat-value" id="healthStatTotal">0</div></div>
        <div class="stat-card"><div class="stat-label">High</div><div class="stat-value" id="healthStatHigh">0</div></div>
        <div class="stat-card"><div class="stat-label">Medium</div><div class="stat-value" id="healthStatMedium">0</div></div>
        <div class="stat-card"><div class="stat-label">Last Generated</div><div class="stat-value" id="healthStatGenerated">—</div></div>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:800;">Due Schedule Maintenance</div>
      <div class="row">
        <select id="healthGenerateMonths">
          <option value="6">Next 6 months</option>
          <option value="12" selected>Next 12 months</option>
          <option value="18">Next 18 months</option>
          <option value="24">Next 24 months</option>
        </select>
        <button id="btnGenerateAllDue" type="button">Generate Missing Due Dates</button>
      </div>
      <div class="muted" id="healthGenerateResult">This only inserts missing due rows. It does not overwrite existing historical amounts.</div>
    </div>

    <div class="card">
      <div style="font-weight:800;">Health View</div>
      <div class="row">
        <button id="healthFilterAll" type="button">All</button>
        <button id="healthFilterHigh" type="button">High</button>
      </div>
      <div class="row">
        <button id="healthFilterMedium" type="button">Medium</button>
        <button id="btnRefreshHealth" type="button">Refresh</button>
      </div>
      <input id="healthSearch" placeholder="Search borrower, issue, details..." />
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-weight:800;">Issues</div>
        <span class="pill" id="healthCountPill">0</span>
      </div>
      <div id="loanHealthList" class="muted">Loading...</div>
    </div>
  `;
}

function ensureLoanHealthPage() {
  const app = qs("app");
  if (!app) return null;

  let page = qs("loanHealthPage");
  if (!page) {
    page = document.createElement("div");
    page.id = "loanHealthPage";
    page.className = "page";
    app.appendChild(page);
  }

  if (!qs("loanHealthList") || !qs("btnGenerateAllDue")) {
    page.innerHTML = loanHealthHtml();
  }

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuLoanHealth")) {
    const btn = document.createElement("button");
    btn.id = "menuLoanHealth";
    btn.className = "menu-link";
    btn.dataset.page = "loanHealthPage";
    btn.textContent = "Loan Health";

    const dueBtn = qs("menuDueOverdue");
    const followBtn = qs("menuFollowups");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, dueBtn || followBtn || defaultsBtn || null);
  }

  const menuBtn = qs("menuLoanHealth");
  if (menuBtn && menuBtn.dataset.bound !== "true") {
    menuBtn.dataset.bound = "true";
    menuBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureLoanHealthPage();
      openPage("loanHealthPage");
      renderHealth(true);
    };
  }

  bindControls();
  return page;
}

function bindControls() {
  const filters = [
    ["healthFilterAll", "ALL"],
    ["healthFilterHigh", "HIGH"],
    ["healthFilterMedium", "MEDIUM"],
  ];

  filters.forEach(([id, value]) => {
    const btn = qs(id);
    if (btn && btn.dataset.bound !== "true") {
      btn.dataset.bound = "true";
      btn.onclick = () => {
        localStorage.setItem("loanLedger.healthFilter", value);
        lastHealthHtml = "";
        renderHealth(true);
      };
    }
  });

  if (qs("btnRefreshHealth") && qs("btnRefreshHealth").dataset.bound !== "true") {
    qs("btnRefreshHealth").dataset.bound = "true";
    qs("btnRefreshHealth").onclick = () => renderHealth(true);
  }

  if (qs("healthSearch") && qs("healthSearch").dataset.bound !== "true") {
    qs("healthSearch").dataset.bound = "true";
    qs("healthSearch").oninput = () => renderHealth(true);
  }

  if (qs("btnGenerateAllDue") && qs("btnGenerateAllDue").dataset.bound !== "true") {
    qs("btnGenerateAllDue").dataset.bound = "true";
    qs("btnGenerateAllDue").onclick = generateAllDueDates;
  }
}

function setFilterButtons() {
  const filter = localStorage.getItem("loanLedger.healthFilter") || "ALL";
  const ids = {
    ALL: "healthFilterAll",
    HIGH: "healthFilterHigh",
    MEDIUM: "healthFilterMedium",
  };
  Object.entries(ids).forEach(([key, id]) => {
    const btn = qs(id);
    if (!btn) return;
    btn.style.background = key === filter ? "#2b63ff" : "#333";
  });
}

function filterIssues(rows) {
  const filter = localStorage.getItem("loanLedger.healthFilter") || "ALL";
  const term = String(qs("healthSearch")?.value || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (filter !== "ALL" && row.severity !== filter) return false;
    if (term) {
      const haystack = [row.issue_code, row.severity, row.borrower_name, row.summary, row.details]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

function renderIssue(row) {
  const genButton = row.issue_code === "NO_FUTURE_DUE"
    ? `<button class="followup-small-btn" data-generate-loan-due="${row.loan_id}" type="button">Generate Due Dates</button>`
    : "";

  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div>
        <strong>${row.borrower_name || "Unknown"}</strong><br>
        <span class="muted">${prettyCode(row.issue_code)}</span>
      </div>
      <span class="pill" style="color:${severityColor(row.severity)};">${row.severity}</span>
    </div>
    <div style="margin-top:8px;">
      <strong>${row.summary}</strong><br>
      <span class="muted">${row.details || "—"}</span><br>
      <span class="muted">Loan: ${String(row.loan_id || "").slice(0, 8)}…</span>
    </div>
    ${genButton}
  `);
}

async function renderHealth(force = false) {
  ensureLoanHealthPage();
  if (!isPage("loanHealthPage") || healthBusy || !qs("loanHealthList")) return;

  healthBusy = true;
  try {
    setFilterButtons();

    const { data, error } = await supabase
      .from("loan_health_issues")
      .select("*")
      .order("severity", { ascending: true })
      .order("borrower_name", { ascending: true });

    if (error) throw error;

    const allRows = data || [];
    const rows = filterIssues(allRows);
    const high = allRows.filter((r) => r.severity === "HIGH").length;
    const medium = allRows.filter((r) => r.severity === "MEDIUM").length;

    qs("healthStatTotal").textContent = String(allRows.length);
    qs("healthStatHigh").textContent = String(high);
    qs("healthStatMedium").textContent = String(medium);
    qs("healthCountPill").textContent = String(rows.length);

    const html = rows.length ? rows.map(renderIssue).join("") : "No loan health issues found.";

    if (force || html !== lastHealthHtml) {
      qs("loanHealthList").innerHTML = html;
      lastHealthHtml = html;
    }

    document.querySelectorAll("[data-generate-loan-due]").forEach((btn) => {
      if (btn.dataset.bound === "true") return;
      btn.dataset.bound = "true";
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Generating...";
        const { data: inserted, error: genErr } = await supabase.rpc("generate_missing_due_events_for_loan", {
          p_loan_id: btn.dataset.generateLoanDue,
          p_through_date: new Date(new Date().setMonth(new Date().getMonth() + 12)).toISOString().slice(0, 10),
          p_from_date: new Date().toISOString().slice(0, 10),
          p_only_active: true,
        });
        if (genErr) {
          btn.disabled = false;
          btn.textContent = "Generate Due Dates";
          alert(genErr.message);
          return;
        }
        alert(`Generated ${inserted || 0} due rows.`);
        lastHealthHtml = "";
        await renderHealth(true);
      };
    });
  } catch (error) {
    console.error(error);
    qs("loanHealthList").innerHTML = error.message || String(error);
  } finally {
    healthBusy = false;
  }
}

async function generateAllDueDates() {
  const months = Number(qs("healthGenerateMonths")?.value || 12);
  const btn = qs("btnGenerateAllDue");
  const result = qs("healthGenerateResult");

  btn.disabled = true;
  btn.textContent = "Generating...";
  result.textContent = "Generating missing due dates...";

  try {
    const { data, error } = await supabase.rpc("generate_missing_due_events_all", {
      p_months_ahead: months,
    });

    if (error) throw error;

    const total = (data || []).reduce((sum, row) => sum + Number(row.inserted_count || 0), 0);
    result.innerHTML = `Generated <strong>${total}</strong> missing due rows across ${(data || []).length} active loans.`;
    qs("healthStatGenerated").textContent = String(total);
    lastHealthHtml = "";
    await renderHealth(true);
  } catch (error) {
    console.error(error);
    result.textContent = error.message || String(error);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Missing Due Dates";
  }
}

async function tick() {
  ensureLoanHealthPage();
  if (isPage("loanHealthPage")) await renderHealth();
}

const observer = new MutationObserver(() => {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(tick, 200);
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2500);
tick();
