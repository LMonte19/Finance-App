function addStyle(id,href){
  if(document.getElementById(id)) return;
  const link=document.createElement('link');
  link.id=id;link.rel='stylesheet';link.href=href;
  document.head.appendChild(link);
}

addStyle('loansDashboardCss','./loans-dashboard.css?v=1');
addStyle('loansDashboardOverridesCss','./loans-dashboard-overrides.css?v=1');

import('./loans-dashboard.js?v=1').catch(error=>console.error('loans dashboard failed to load',error));
