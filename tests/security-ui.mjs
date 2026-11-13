import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const OWNER='owner';
let session=null, calls=0, nextProfile=null;
const nodes=new Map(['menuMaintenance','btnResetTestData','borrowerList','loanBorrower'].map(id=>[id,{dataset:{},style:{},innerHTML:''}]));
const dbClient={auth:{onAuthStateChange(){}}};
const context=vm.createContext({
  console, Promise,
  document:{body:{},getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[]},
  window:{localStorage:{},addEventListener(){}},
  MutationObserver:class{observe(){}},
  setTimeout:()=>1,clearTimeout(){},setInterval(){},
  createClient:()=>dbClient,
  ACCESS_OWNER_ID:OWNER,getPageSessionId:()=>session,
  readViewer:async()=>{calls++;return nextProfile;},roleName:x=>x,
});
const source=fs.readFileSync(new URL('../role-security.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
vm.runInContext(source+'\nglobalThis.guard=applyRoleGuards;globalThis.reset=resetProfileGuard;',context);
await context.guard();assert.equal(calls,0,'No auth request without an approved page session');
assert.equal(nodes.get('menuMaintenance').style.display,'none');
session=OWNER;nextProfile={role:'ADMIN',full_name:'Owner'};
await context.guard();for(let i=0;i<20;i++)await context.guard();
assert.equal(calls,1,'DOM changes must reuse the loaded profile');
assert.equal(nodes.get('menuMaintenance').style.display,'');
session='partner';nextProfile={role:'PARTNER',full_name:'Partner'};
await context.guard();assert.equal(nodes.get('menuMaintenance').style.display,'none');
session='other-admin';nextProfile={role:'ADMIN'};
await context.guard();assert.equal(nodes.get('btnResetTestData').style.display,'none','ADMIN alone cannot display owner tools');
session='unapproved';nextProfile=null;context.reset();await context.guard();const before=calls;
for(let i=0;i<20;i++)await context.guard();assert.equal(calls,before,'A missing profile must not trigger a polling storm');
session=null;await context.guard();assert.equal(nodes.get('menuMaintenance').style.display,'none');

// Exercise the real legacy rendering path; hidden DOM is still an XSS surface.
const malicious='\"><img src=x onerror="alert(1)">';
const shared=fs.readFileSync(new URL('../combined-workspace-ui.js',import.meta.url),'utf8');
const escapeDefinition=shared.split('\n').find(line=>line.startsWith('export const esc='));
vm.runInContext(escapeDefinition.replace('export ',''),context);
dbClient.from=()=>({select:()=>({order:()=>({data:[{id:'id',full_name:malicious,phone:malicious,notes:malicious}]})})});
context.readPageQuery=async(_key,loader)=>loader();
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const renderer=app.slice(app.indexOf('async function refreshBorrowers()'),app.indexOf('function addPendingLoanFunding('));
vm.runInContext(renderer+'\nglobalThis.renderBorrowers=refreshBorrowers;',context);
await context.renderBorrowers();
for(const id of ['borrowerList','loanBorrower']){
  const html=nodes.get(id).innerHTML;assert.ok(!html.includes('<img'),'User text must not become an image element');
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&quot;'));
}
console.log('Security UI checks passed: session guard, owner visibility, polling and stored text escaping.');
