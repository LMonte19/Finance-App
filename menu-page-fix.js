const qs = (id) => document.getElementById(id);

function ensureDynamicPage(id, title) {
  if (qs(id)) return qs(id);

  const app = qs("app");
  if (!app) return null;

  const page = document.createElement("div");
  page.id = id;
  page.className = "page";
  page.innerHTML = `
    <div class="card">
      <div style="font-weight:800;">${title}</div>
      <div id="${id}Content" class="muted">Loading...</div>
    </div>
  `;
  app.appendChild(page);
  return page;
}

function repairMenuPages() {
  const map = [
    ["menuDueOverdue", "dueOverduePage", "Due / Overdue"],
    ["menuProfiles", "profilesPage", "Profiles / Users"],
    ["menuReports", "reportsPage", "Reports / Export"],
    ["menuMaintenance", "maintenancePage", "Maintenance"],
  ];

  map.forEach(([buttonId, pageId, title]) => {
    const btn = qs(buttonId);
    if (btn) btn.dataset.page = pageId;
    ensureDynamicPage(pageId, title);
  });
}

// The original app.js assigns menu click handlers to .menu-link buttons.
// New extension buttons need data-page already present, otherwise app.js opens "nothing".
// Running this repeatedly keeps the dynamic pages repaired even if scripts load in a different order.
setInterval(repairMenuPages, 300);
repairMenuPages();
