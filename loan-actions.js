// Passive legacy file.
// Loan-level details/actions belonged to the old individual-loan model.
// The app now uses account-level borrower pages, virtual due dates, and account payments.
// Keeping this file active could recreate old Loan Details, Due Schedule, and Generate Due Dates panels.

function removeLegacyLoanActionUi() {
  document.getElementById('loanActionsPanel')?.remove();
  document.getElementById('loanEditBox')?.remove();
  document.getElementById('dueExtensionBox')?.remove();
  document.getElementById('loanDetailsPage')?.remove();
}

setInterval(removeLegacyLoanActionUi, 1500);
removeLegacyLoanActionUi();
console.log('legacy loan-actions disabled; account page owns loan workflow');
