const qs = (id) => document.getElementById(id);

function repairMenuButtonsOnly() {
  const map = [
    ["menuDueOverdue", "dueOverduePage"],
    ["menuProfiles", "profilesPage"],
    ["menuReports", "reportsPage"],
    ["menuMaintenance", "maintenancePage"],
    ["menuActivity", "activityPage"],
    ["menuLoanHealth", "loanHealthPage"],
    ["menuSystemCheck", "systemCheckPage"],
  ];

  map.forEach(([buttonId, pageId]) => {
    const btn = qs(buttonId);
    if (btn) btn.dataset.page = pageId;
  });
}

// This file used to create placeholder pages. That caused old blank sections
// to appear before the real modules rendered. Now each feature module owns
// its own page; this helper only repairs menu button data-page attributes.
setInterval(repairMenuButtonsOnly, 1000);
repairMenuButtonsOnly();
