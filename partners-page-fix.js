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
let busy = false;
let cachedPartnerSummary = [];

function isPartnersPage() {
  return qs("partnersPage")?.classList.contains("active-page");
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function clickableCard(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;cursor:pointer;">${html}</div>`;
}

function normalizePartner(row = {}) {
  return {
    id: row.user_id || row.partner_user_id,
    name: row.full_name || row.partner_name || "Unnamed profile",
    role: row.role || row.partner_role || "—",
    total: Number(row.total_earned || 0),
    management: Number(row.management_earned || 0),
    funding: Number(row.funding_earned ?? row.funder_earned ?? 0),
    count: Number(row.allocation_count || 0),
  };
}

function friendlyType(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("MANAGEMENT")) return "Management fee";
  if (value.includes("FUNDER") || value.includes("FUNDING") || value.includes("PARTNER")) return "Funder distribution";
  return type || "Allocation";
}

function isVoided(row = {}) {
  return row.is_voided === true;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

async function renderPartners(force = false) {
  const page = qs("partnersPage");
  if (!page || !isPartnersPage() || busy) return;

  // Do not let the auto-refresh timer redraw the main Partners list while a detail page is open.
  if (page.dataset.partnerDetailOpen === "true" && !force) return;

  const stamp = `${Date.now() - (Date.now() % 3000)}`;
  if (!force && page.dataset.partnersFixStamp === stamp) return;

  busy = true;
  try {
    const [{ data: summary, error: summaryErr }, { data: allocations, error: allocationErr }] = await Promise.all([
      supabase.from("partner_earnings_summary").select("*").order("total_earned", { ascending: false }),
      supabase.from("partner_allocation_details").select("*").order("created_at", { ascending: false }).limit(25),
    ]);

    if (summaryErr) throw summaryErr;
    if (allocationErr) throw allocationErr;

    const rows = (summary || []).map(normalizePartner);
    const recent = (allocations || []).filter((a) => !isVoided(a));
    const partnerMap = Object.fromEntries(rows.map((p) => [p.id, p]));

    cachedPartnerSummary = rows;

    const totalEarned = rows.reduce((sum, p) => sum + p.total, 0);
    const totalMgmt = rows.reduce((sum, p) => sum + p.management, 0);
    const totalFunding = rows.reduce((sum, p) => sum + p.funding, 0);
    const totalAllocations = rows.reduce((sum, p) => sum + p.count, 0);

    page.dataset.partnersFixStamp = stamp;
    page.dataset.partnerDetailOpen = "false";
    page.innerHTML = `
      <div class="card">
        <div style="font-weight:800;">Partners Overview</div>
        <div class="muted">Earnings are calculated from non-voided payment allocations.</div>

        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">Total Earnings</div><div class="stat-value">${money(totalEarned)}</div></div>
          <div class="stat-card"><div class="stat-label">Management</div><div class="stat-value">${money(totalMgmt)}</div></div>
          <div class="stat-card"><div class="stat-label">Funding</div><div class="stat-value">${money(totalFunding)}</div></div>
          <div class="stat-card"><div class="stat-label">Allocations</div><div class="stat-value">${totalAllocations}</div></div>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:800;">Earnings by Partner</div>
        ${rows.length ? rows.map((p) => clickableCard(`
          <strong>${p.name}</strong> <span class="muted">${p.role}</span><br>
          <span class="muted">Total: ${money(p.total)} | Management: ${money(p.management)} | Funding: ${money(p.funding)}</span><br>
          <span class="muted">Allocations: ${p.count} | Click for details</span>
        `, `data-partner-detail-id="${p.id}"`)).join("") : "No partner earnings yet."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Recent Allocations</div>
        ${recent.length ? recent.map((a) => {
          const partner = partnerMap[a.partner_user_id];
          return card(`
            <strong>${partner?.name || a.partner_name || "Unknown partner"}</strong> — ${money(a.amount)}<br>
            <span class="muted">${friendlyType(a.allocation_type)} | ${a.borrower_name || "No borrower"} | ${a.paid_on || new Date(a.created_at).toLocaleDateString()}</span>
          `);
        }).join("") : "No allocations yet. New payments will create them automatically."}
      </div>
    `;

    document.querySelectorAll("[data-partner-detail-id]").forEach((el) => {
      el.onclick = () => renderPartnerDetails(el.dataset.partnerDetailId);
    });
  } catch (error) {
    console.error(error);
    page.innerHTML = `<div class="card"><strong>Partners</strong><br><span class="muted">${error.message || String(error)}</span></div>`;
  } finally {
    busy = false;
  }
}

async function renderPartnerDetails(partnerId) {
  const page = qs("partnersPage");
  if (!page) return;

  page.dataset.partnerDetailOpen = "true";
  page.innerHTML = `<div class="card"><strong>Partner Details</strong><br><span class="muted">Loading...</span></div>`;

  try {
    const [summaryRes, fundedLoansRes, allocationsRes] = await Promise.all([
      supabase.from("partner_earnings_summary").select("*"),
      supabase.from("partner_funded_loans").select("*").eq("partner_user_id", partnerId).order("start_date", { ascending: false }),
      supabase.from("partner_allocation_details").select("*").eq("partner_user_id", partnerId).order("created_at", { ascending: false }).limit(100),
    ]);

    if (summaryRes.error) throw summaryRes.error;
    if (fundedLoansRes.error) throw fundedLoansRes.error;
    if (allocationsRes.error) throw allocationsRes.error;

    const partner = (summaryRes.data || []).map(normalizePartner).find((p) => p.id === partnerId)
      || cachedPartnerSummary.find((p) => p.id === partnerId)
      || { id: partnerId, name: "Unknown partner", role: "—", total: 0, management: 0, funding: 0, count: 0 };

    const fundedLoans = fundedLoansRes.data || [];
    const allocations = (allocationsRes.data || []).filter((a) => !isVoided(a));
    const allocationByLoan = groupBy(allocations, (a) => a.loan_id || "No loan");
    const allocationByBorrower = groupBy(allocations, (a) => a.borrower_name || "No borrower");

    const byLoanHtml = Array.from(allocationByLoan.entries()).map(([loanId, rows]) => {
      const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      const first = rows[0] || {};
      return card(`
        <strong>${first.borrower_name || "Unknown borrower"}</strong><br>
        <span class="muted">Loan: ${String(loanId).slice(0, 8)} | Total earned: ${money(total)} | Allocations: ${rows.length}</span>
      `);
    }).join("");

    const byBorrowerHtml = Array.from(allocationByBorrower.entries()).map(([borrowerName, rows]) => {
      const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      return card(`
        <strong>${borrowerName}</strong><br>
        <span class="muted">Total earned: ${money(total)} | Allocations: ${rows.length}</span>
      `);
    }).join("");

    page.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:800;">Partner Details</div>
          <button id="btnBackToPartners" type="button" style="width:auto;background:#333;padding:10px 14px;">Back</button>
        </div>
        <div style="margin-top:12px;">
          <strong>${partner.name}</strong> <span class="muted">${partner.role}</span><br>
          <span class="muted">Total: ${money(partner.total)} | Management: ${money(partner.management)} | Funding: ${money(partner.funding)} | Allocations: ${partner.count}</span>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:800;">Loans Funded</div>
        ${fundedLoans.length ? fundedLoans.map((loan) => card(`
          <strong>${loan.borrower_name || "Unknown borrower"}</strong><br>
          <span class="muted">Funding: ${(Number(loan.funding_percent || 0) * 100).toFixed(2)}% | Start: ${loan.start_date} | ${loan.status}</span><br>
          <span class="muted">Original: ${money(loan.principal_original)} | Balance: ${money(loan.principal_outstanding)}</span>
        `)).join("") : "No loans funded yet."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Earnings by Loan</div>
        ${byLoanHtml || "No loan earnings yet."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Earnings by Borrower</div>
        ${byBorrowerHtml || "No borrower earnings yet."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Recent Partner Allocations</div>
        ${allocations.length ? allocations.slice(0, 25).map((a) => card(`
          <strong>${money(a.amount)}</strong> — ${friendlyType(a.allocation_type)}<br>
          <span class="muted">${a.borrower_name || "No borrower"} | Payment date: ${a.paid_on || "—"} | Created: ${new Date(a.created_at).toLocaleString()}</span>
        `)).join("") : "No allocations yet."}
      </div>
    `;

    qs("btnBackToPartners").onclick = () => {
      page.dataset.partnerDetailOpen = "false";
      renderPartners(true);
    };
  } catch (error) {
    console.error(error);
    page.innerHTML = `<div class="card"><strong>Partner Details</strong><br><span class="muted">${error.message || String(error)}</span><br><button id="btnBackToPartners" type="button">Back</button></div>`;
    qs("btnBackToPartners").onclick = () => {
      page.dataset.partnerDetailOpen = "false";
      renderPartners(true);
    };
  }
}

const observer = new MutationObserver(() => setTimeout(renderPartners, 150));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(renderPartners, 1000);
renderPartners(true);
