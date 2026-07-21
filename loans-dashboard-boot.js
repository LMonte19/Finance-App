function addStyle(id,href){
  const existing=document.getElementById(id);
  if(existing){ existing.href=href; return; }
  const link=document.createElement('link');
  link.id=id;link.rel='stylesheet';link.href=href;
  document.head.appendChild(link);
}

addStyle('loansDashboardCss','./loans-dashboard.css?v=2');
addStyle('loansDashboardOverridesCss','./loans-dashboard-overrides.css?v=2');

import('./loans-dashboard.js?v=2')
  .then(()=>import('./loans-dashboard-transition-fix.js?v=1'))
  .catch(error=>console.error('loans dashboard failed to load',error));