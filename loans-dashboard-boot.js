function addStyle(id,href){
  const existing=document.getElementById(id);
  if(existing){ existing.href=href; return; }
  const link=document.createElement('link');
  link.id=id;link.rel='stylesheet';link.href=href;
  document.head.appendChild(link);
}

addStyle('loansDashboardCss','./loans-dashboard.css?v=4');
addStyle('loansDashboardOverridesCss','./loans-dashboard-overrides.css?v=4');
addStyle('loansDashboardPolishCss','./loans-dashboard-polish.css?v=2');
addStyle('loansDashboardFinalCss','./loans-dashboard-final.css?v=3');
addStyle('loansDashboardCorrectionsCss','./loans-dashboard-corrections.css?v=3');

import('./loans-dashboard.js?v=5')
  .then(()=>import('./loans-dashboard-corrections.js?v=3'))
  .catch(error=>console.error('loans dashboard failed to load',error));
