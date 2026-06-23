// Passive helper for account page stability.
// due-extension.js owns the account view, but it can still refresh while a user is typing.
// This tiny helper remembers the payment fields and restores them if the section refreshes.

let acctSaved = { amount: '', date: '', type: '', notes: '', active: '' };

function rememberAcctFields() {
  const box = document.getElementById('borrowerAccountContent');
  if (!box) return;

  const active = document.activeElement;
  if (active && box.contains(active)) acctSaved.active = active.id || acctSaved.active;

  const amount = document.getElementById('acctPayAmount');
  const date = document.getElementById('acctPayDate');
  const type = document.getElementById('acctPayType');
  const notes = document.getElementById('acctPayNotes');

  if (amount && amount.value) acctSaved.amount = amount.value;
  if (date && date.value) acctSaved.date = date.value;
  if (type && type.value) acctSaved.type = type.value;
  if (notes && notes.value) acctSaved.notes = notes.value;
}

function restoreAcctFields() {
  const box = document.getElementById('borrowerAccountContent');
  if (!box) return;

  const amount = document.getElementById('acctPayAmount');
  const date = document.getElementById('acctPayDate');
  const type = document.getElementById('acctPayType');
  const notes = document.getElementById('acctPayNotes');

  if (amount && acctSaved.amount && !amount.value) amount.value = acctSaved.amount;
  if (date && acctSaved.date && !date.value) date.value = acctSaved.date;
  if (type && acctSaved.type && type.value !== acctSaved.type) type.value = acctSaved.type;
  if (notes && acctSaved.notes && !notes.value) notes.value = acctSaved.notes;

  const active = acctSaved.active ? document.getElementById(acctSaved.active) : null;
  if (active && box.contains(active) && document.activeElement !== active) {
    active.focus({ preventScroll: true });
  }
}

setInterval(() => {
  rememberAcctFields();
  restoreAcctFields();
}, 150);

console.log('account field stability helper active');
