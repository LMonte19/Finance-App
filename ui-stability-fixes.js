// Passive stability helper.
// Earlier versions of this file rendered Activity/History and repaired old payment lists.
// Those pages now have official owners:
// - activity-log.js owns Activity / History
// - payment-management.js and due-extension.js own Payments
// Keeping legacy renderers active caused duplicate/old sections to flash briefly.

function cleanupLegacyUi() {
  document.querySelectorAll('#loanDetailsPage, #borrowerDetailsPage').forEach((el) => {
    el.remove();
  });

  document.querySelectorAll('.view-toggle, #btnLoansByBorrower, #btnLoansByLoan').forEach((el) => {
    el.remove();
  });

  const quickGenerate = document.getElementById('quickGenerateDue');
  if (quickGenerate) quickGenerate.remove();

  const maintenanceCards = Array.from(document.querySelectorAll('.card')).filter((card) => {
    const title = card.querySelector("div[style*='font-weight:800']")?.textContent?.trim() || '';
    return ['Mantenimiento de cuotas', 'Due Schedule Maintenance', 'Generate Due Dates'].includes(title);
  });
  maintenanceCards.forEach((card) => card.remove());
}

setInterval(cleanupLegacyUi, 1500);
cleanupLegacyUi();
console.log('legacy stability helper passive; cleanup only');
