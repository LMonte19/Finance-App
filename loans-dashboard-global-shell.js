function ensureLoansGlobalShellStyle(){
  const href='./loans-dashboard-global-shell.css?v=1';
  let link=document.getElementById('loansDashboardGlobalShellCss');
  if(link){ if(link.getAttribute('href')!==href) link.setAttribute('href',href); return; }
  link=document.createElement('link');
  link.id='loansDashboardGlobalShellCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

ensureLoansGlobalShellStyle();
document.addEventListener('DOMContentLoaded',ensureLoansGlobalShellStyle);
console.log('loans dashboard global shell layout active');
