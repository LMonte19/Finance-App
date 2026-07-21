function addStyle(id,href){
  const existing=document.getElementById(id);
  if(existing){ existing.href=href; return; }
  const link=document.createElement('link');
  link.id=id;link.rel='stylesheet';link.href=href;
  document.head.appendChild(link);
}

addStyle('loansDashboardCss','./loans-dashboard.css?v=2');
addStyle('loansDashboardOverridesCss','./loans-dashboard-overrides.css?v=2');
addStyle('loansDashboardPolishCss','./loans-dashboard-polish.css?v=1');
addStyle('loansDashboardFinalCss','./loans-dashboard-final.css?v=3');

import('./loans-dashboard.js?v=2')
  .then(()=>import('./loans-dashboard-transition-fix.js?v=1'))
  .then(()=>import('./loans-dashboard-polish.js?v=2'))
  .then(()=>import('./loans-dashboard-period.js?v=1'))
  .catch(error=>console.error('loans dashboard failed to load',error));
