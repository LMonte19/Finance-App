import './admin-tools.js?v=2';
import './batch-tools.js?v=2';
import './menu-page-fix.js?v=1';
import './loan-view-fix.js?v=5';
import './partners-page-fix.js?v=4';
import './settings-validation-fix.js?v=1';
import './payment-management.js?v=4';
import './activity-log.js?v=2';
import './followups.js?v=1';
import './loan-health.js?v=1';
import './home-dashboard.js?v=4';
import './role-security.js?v=1';
import './system-check.js?v=1';
import './language-toggle.js?v=3';
import './account-router.js?v=1';
import './loans-dashboard-boot.js?v=12';
import './global-app-sidebar.js?v=2';
import './loans-dashboard-global-shell.js?v=1';
import './clients-management.js?v=1';
import './client-profile-controller.js?v=2';

const paymentManagementCss=document.getElementById('paymentManagementCss');
if(paymentManagementCss) paymentManagementCss.href='./payment-management.css?v=2';

const homeDashboardCss=document.getElementById('homeDashboardCss');
if(homeDashboardCss) homeDashboardCss.href='./home-dashboard.css?v=4';

let homeDashboardKpiCss=document.getElementById('homeDashboardKpiCss');
if(!homeDashboardKpiCss){
  homeDashboardKpiCss=document.createElement('link');
  homeDashboardKpiCss.id='homeDashboardKpiCss';
  homeDashboardKpiCss.rel='stylesheet';
  document.head.appendChild(homeDashboardKpiCss);
}
homeDashboardKpiCss.href='./home-dashboard-kpis.css?v=4';

const clientProfileControllerCss=document.getElementById('clientProfileControllerCss');
if(clientProfileControllerCss) clientProfileControllerCss.href='./client-profile-controller.css?v=2';

console.log('safe module loader active — modern home, payments, clients and single client profile controller');