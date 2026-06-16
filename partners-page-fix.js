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

function isPartnersPage() {
  return qs("partnersPage")?.classList.contains("active-page");
}

function card(html) {
  return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function friendlyType(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("MANAGEMENT")) return "Management fee";
  if (value.includes("FUNDER") || value.includes("FUNDING")) return "Funder distribution";
  return type || "Allocation";
}

function allocationClass(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("MANAGEMENT")) return "Management";
  if (value.includes("FUNDER") || value.includes("FUNDING")) return "Funding";
  return "Other";
}

async function renderPartners(force = false) {
  const page = qs("partnersPage");
  if (!page || !isPartnersPage() || busy) return;

  const stamp = `${Date.now() - (Date.now() % 3000)}`;
  if (!force && page.dataset.partnersFixStamp === stamp) return;

  busy = true;
  try {
    const [{ data: summary, error: summaryErr }, { data: allocations, error: allocationErr }] = await Promise.all([
      supabase
        .from("partner_earnings_summary")
        .select("user_id, full_name, role, total_earned, management_earned, funding_earned, allocation_count")
        .order("total_earned", { ascending: false }),
      supabase
        .from("payment_allocations")
        .select("id, payment_id, allocation_type, partner_user_id, amount, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (summaryErr) throw summaryErr;
    if (allocationErr) throw allocationErr;

    const rows = summary || [];
    const recent = allocations || [];
    const partnerMap = Object.fromEntries(rows.map((p) => [p.user_id, p]));

    const totalEarned = rows.reduce((sum, p) => sum + Number(p.total_earned || 0), 0);
    const totalMgmt = rows.reduce((sum, p) => sum + Number(p.management_earned || 0), 0);
    const totalFunding = rows.reduce((sum, p) => sum + Number(p.funding_earned || 0), 0);
    const totalAllocations = rows.reduce((sum, p) => sum + Number(p.allocation_count || 0), 0);

    page.dataset.partnersFixStamp = stamp;
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
        ${rows.length ? rows.map((p) => card(`
          <strong>${p.full_name || "Unnamed profile"}</strong> <span class="muted">${p.role || "—"}</span><br>
          <span class="muted">Total: ${money(p.total_earned)} | Management: ${money(p.management_earned)} | Funding: ${money(p.funding_earned)}</span><br>
          <span class="muted">Allocations: ${p.allocation_count || 0}</span>
        `)).join("") : "No partner earnings yet."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Recent Allocations</div>
        ${recent.length ? recent.map((a) => {
          const partner = partnerMap[a.partner_user_id];
          return card(`
            <strong>${partner?.full_name || "Unknown partner"}</strong> — ${money(a.amount)}<br>
            <span class="muted">${friendlyType(a.allocation_type)} | ${allocationClass(a.allocation_type)} | ${new Date(a.created_at).toLocaleString()}</span>
          `);
        }).join("") : "No allocations yet. New payments will create them automatically."}
      </div>
    `;
  } catch (error) {
    console.error(error);
    page.innerHTML = `<div class="card"><strong>Partners</strong><br><span class="muted">${error.message || String(error)}</span></div>`;
  } finally {
    busy = false;
  }
}

const observer = new MutationObserver(() => setTimeout(renderPartners, 150));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(renderPartners, 1000);
renderPartners(true);
