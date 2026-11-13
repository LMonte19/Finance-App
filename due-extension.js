import './admin-tools.js?v=4';
import './batch-tools.js?v=4';
import './menu-page-fix.js?v=2';
import './loan-view-fix.js?v=10';
import './partners-page-fix.js?v=10';
import './settings-validation-fix.js?v=3';
import './payment-management.js?v=17';
import './activity-log.js?v=5';
import './followups.js?v=3';
import './home-dashboard.js?v=32';
import './role-security.js?v=5';
import './system-check.js?v=4';
import './language-toggle.js?v=4';
import './account-router.js?v=2';
import './loans-dashboard-boot.js?v=25';
import './global-app-sidebar.js?v=8';
import './loans-dashboard-global-shell.js?v=4';
import './clients-management.js?v=5';
import './client-profile-controller.js?v=24';
import './app-design-system.js?v=2';

const paymentManagementCss=document.getElementById('paymentManagementCss');
if(paymentManagementCss) paymentManagementCss.href='./payment-management.css?v=5';

const homeDashboardCss=document.getElementById('homeDashboardCss');
if(homeDashboardCss) homeDashboardCss.href='./home-dashboard.css?v=22';

let homeDashboardKpiCss=document.getElementById('homeDashboardKpiCss');
if(!homeDashboardKpiCss){
  homeDashboardKpiCss=document.createElement('link');
  homeDashboardKpiCss.id='homeDashboardKpiCss';
  homeDashboardKpiCss.rel='stylesheet';
  document.head.appendChild(homeDashboardKpiCss);
}
homeDashboardKpiCss.href='./home-dashboard-kpis.css?v=9';

let homeDashboardAnalyticsCss=document.getElementById('homeDashboardAnalyticsCss');
if(!homeDashboardAnalyticsCss){
  homeDashboardAnalyticsCss=document.createElement('link');
  homeDashboardAnalyticsCss.id='homeDashboardAnalyticsCss';
  homeDashboardAnalyticsCss.rel='stylesheet';
  document.head.appendChild(homeDashboardAnalyticsCss);
}
homeDashboardAnalyticsCss.href='./home-dashboard-analytics.css?v=10';

let homeDashboardThemeCss=document.getElementById('homeDashboardThemeCss');
if(!homeDashboardThemeCss){
  homeDashboardThemeCss=document.createElement('link');
  homeDashboardThemeCss.id='homeDashboardThemeCss';
  homeDashboardThemeCss.rel='stylesheet';
  document.head.appendChild(homeDashboardThemeCss);
}
homeDashboardThemeCss.href='./home-dashboard-theme.css?v=2';


const clientProfileControllerCss=document.getElementById('clientProfileControllerCss');
if(clientProfileControllerCss) clientProfileControllerCss.href='./client-profile-controller.css?v=3';

console.log('safe module loader active — modern home, payments, clients and single client profile controller');
