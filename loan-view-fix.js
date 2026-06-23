import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
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

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
let rendering = false;
let queued = false;
let lastHtml = "";

function isLoansPageActive() {
  return $("loansPage")?.classList.contains("active-page");
}

function looksLegacy() {
  const html = $("loanList")?.innerHTML || "";
  return html.includes("Next Due:") || html.includes("Amount Due:") || html.includes("Original:") || html.includes("Total Outstanding:") || html.includes("data-loan-id=");
}

function accountStatusClass(status) {
  if (status === "ATRASADO") return "color:#ff8b8b;";
  return "color:#9ff5b2;";
}

function removeLegacyToggles() {
  $("loanViewToggle")?.remove();
  $("btnLoansByBorrower")?.closest(".view-toggle")?.remove();
}

function card(html, borrowerId) {
  return `
    <div class="compact-card account-loan-card" data-account-borrower="${borrowerId}" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;cursor:pointer;">
      ${html}
    </div>
  `;
}

async function renderAccountLoans(force = false) {
  if (!isLoansPageActive() || rendering || !$("loanList")) return;
  if (!force && !looksLegacy() && $("loanList")?.dataset.accountOwned === "true") return;

  rendering = true;
  try {
    removeLegacyToggles();

    const [accountsRes, disbursementsRes] = await Promise.all([
      db.from("borrower_account_summary").select("*").order("full_name", { ascending: true }),
      db.from("borrower_disbursements_view").select("*").order("start_date", { ascending: false }),
    ]);

    if (accountsRes.error) throw accountsRes.error;
    if (disbursementsRes.error) throw disbursementsRes.error;

    const byBorrower = new Map();
    (disbursementsRes.data || []).forEach((d) => {
      if (!byBorrower.has(d.borrower_id)) byBorrower.set(d.borrower_id, []);
      byBorrower.get(d.borrower_id).push(d);
    });

    const html = (accountsRes.data || []).map((a) => {
      const recent = (byBorrower.get(a.borrower_id) || []).slice(0, 3).map((d) => `
        <div style="margin:6px 0;">
          <strong>${d.start_date}</strong> — Desembolso ${money(d.principal_original)} | Balance ${money(d.principal_outstanding)} | ${d.status}
        </div>
      `).join("") || "Sin desembolsos.";

      return card(`
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div><strong>${a.full_name}</strong><br><span class="muted">${a.phone || "Sin teléfono"}</span></div>
          <span class="pill" style="${accountStatusClass(a.account_status)}">${a.account_status}</span>
        </div>
        <div style="margin-top:8px;">
          Balance de capital: <strong>${money(a.principal_balance)}</strong> | Total desembolsado: ${money(a.total_disbursed)}<br>
          Cuota mensual actual: <strong>${money(a.current_monthly_fee)}</strong> | Cuota por ciclo: ${money(a.current_cycle_fee)}<br>
          Próxima cuota: ${a.next_due_date || "—"} | Atrasado: ${money(a.overdue_amount)}
        </div>
        <div style="border-top:1px solid #2a2a2e;margin-top:10px;padding-top:10px;">${recent}</div>
        <div class="muted" style="margin-top:10px;">Clic para abrir cuenta completa.</div>
      `, a.borrower_id);
    }).join("") || "No hay clientes/cuentas para mostrar.";

    if (force || html !== lastHtml || $("loanList").dataset.accountOwned !== "true") {
      $("loanList").innerHTML = html;
      $("loanList").dataset.accountOwned = "true";
      lastHtml = html;
    }

    document.querySelectorAll("[data-account-borrower]").forEach((el) => {
      el.onclick = () => {
        window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: el.dataset.accountBorrower } }));
      };
    });
  } catch (error) {
    console.error(error);
    if ($("loanList")) $("loanList").innerHTML = error.message || String(error);
  } finally {
    rendering = false;
    if (queued) {
      queued = false;
      setTimeout(() => renderAccountLoans(true), 0);
    }
  }
}

function scheduleRender(force = false) {
  if (rendering) {
    queued = true;
    return;
  }
  setTimeout(() => renderAccountLoans(force), 0);
}

function watchLoanList() {
  const list = $("loanList");
  if (!list || list.dataset.accountGuardAttached === "true") return;
  list.dataset.accountGuardAttached = "true";
  new MutationObserver(() => {
    if (isLoansPageActive() && looksLegacy()) scheduleRender(true);
  }).observe(list, { childList: true, subtree: true, characterData: true });
}

function tick() {
  if (isLoansPageActive()) {
    removeLegacyToggles();
    watchLoanList();
    scheduleRender(false);
  }
}

window.addEventListener("loan-ledger:render-account-loans", () => scheduleRender(true));

new MutationObserver(tick).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class"],
});

setInterval(tick, 400);
tick();
