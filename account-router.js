const $ = id => document.getElementById(id);

function ensureAccountPage(){
  const app=$('app');
  if(!app) return null;
  let page=$('borrowerAccountPage');
  if(page) return page;
  page=document.createElement('div');
  page.id='borrowerAccountPage';
  page.className='page';
  page.innerHTML='<div id="borrowerAccountContent"></div>';
  app.appendChild(page);
  return page;
}

function openPage(id){
  document.querySelectorAll('.tab-btn').forEach(button=>button.classList.remove('active'));
  document.querySelectorAll('.page').forEach(page=>page.classList.remove('active-page'));
  document.querySelector(`.tab-btn[data-page="${id}"]`)?.classList.add('active');
  $(id)?.classList.add('active-page');
  $('sideMenu')?.classList.remove('open');
  $('menuOverlay')?.classList.remove('open');
}

function requestAccount(borrowerId){
  if(!borrowerId) return;
  ensureAccountPage();
  openPage('borrowerAccountPage');
  window.dispatchEvent(new CustomEvent('loan-ledger:account-rendered',{
    detail:{borrowerId,source:'account-router'}
  }));
}

document.addEventListener('click',event=>{
  const card=event.target.closest?.('[data-acct-borrower]');
  if(!card?.dataset.acctBorrower) return;
  if(card.closest('#borrowerAccountContent .ll-client-rail')) return; // handled by stability layer
  event.preventDefault();
  requestAccount(card.dataset.acctBorrower);
},true);

window.addEventListener('loan-ledger:open-account',event=>{
  const id=event.detail?.borrowerId;
  if(id) requestAccount(id);
});

ensureAccountPage();
console.log('account router active — legacy account renderer removed');
