import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase=createClient(
  "https://eatxkhhpjruwwibhcubf.supabase.co",
  "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q",
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:"loan-ledger-auth"}}
);

function ensureStyle(){
  const href="./clients-management.css?v=1";
  let link=document.getElementById("clientsManagementCss");
  if(!link){link=document.createElement("link");link.id="clientsManagementCss";link.rel="stylesheet";document.head.appendChild(link);}
  link.href=href;
}
ensureStyle();

const qs=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=name=>String(name||"?").trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("")||"?";
const PAGE_SIZE=8;
let borrowers=[];
let accountMap=new Map();
let activityRows=[];
let activityByBorrower=new Map();
let filter="all";
let sort="name";
let view="list";
let page=1;
let loading=false;
let lastLoadAt=0;

const ICONS={
  plus:'<path d="M12 5v14M5 12h14"/>',
  user:'<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-4.4 2.8-6.6 6.5-6.6s5.9 2.2 6.5 6.6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8" fill="currentColor"/><circle cx="4" cy="12" r=".8" fill="currentColor"/><circle cx="4" cy="18" r=".8" fill="currentColor"/>',
  grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  phone:'<path d="M7.5 4.8 10 8.6 8.2 10c1 2.5 3 4.5 5.5 5.5l1.5-1.8 3.8 2.5c.4.3.6.8.4 1.3-.5 1.4-1.8 2.3-3.3 2.2C10 19.2 4.8 14 4.3 7.9c-.1-1.5.8-2.8 2.2-3.3.4-.1.8 0 1 .2Z"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  note:'<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4M9 12h6M9 16h5"/>',
  payment:'<path d="M12 4v15M7 14l5 5 5-5"/>',
  edit:'<path d="m5 16.5-.8 3.3 3.3-.8L18 8.5 15.5 6 5 16.5Z"/><path d="m14 7.5 2.5 2.5"/>'
};
function svg(name,size=16){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.user}</svg>`;}

function isClientsPage(){return qs("borrowersPage")?.classList.contains("active-page");}
function fmtDate(value){
  if(!value)return "—";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "—";
  const now=new Date();
  const diff=now-date;
  if(diff<60000)return "Ahora";
  if(diff<3600000)return `Hace ${Math.max(1,Math.floor(diff/60000))} min`;
  if(diff<86400000)return `Hace ${Math.max(1,Math.floor(diff/3600000))} h`;
  if(diff<172800000)return "Ayer";
  return date.toLocaleDateString("es",{day:"2-digit",month:"short",year:"numeric"}).replace(".","");
}
function latestActivityDate(b){
  const candidates=[b.created_at,activityByBorrower.get(String(b.id))?.created_at,accountMap.get(String(b.id))?.last_payment_date].filter(Boolean).map(v=>new Date(v).getTime()).filter(Number.isFinite);
  return candidates.length?new Date(Math.max(...candidates)):null;
}
function statusTone(account){
  const key=String(account?.account_status||"").toUpperCase();
  if(["OVERDUE","ATRASADO"].includes(key))return "danger";
  if(["PAID_OFF","CLOSED"].includes(key))return "closed";
  return account?"ok":"neutral";
}
function ensureClientsDom(){
  const host=qs("borrowersPage");
  if(!host||qs("clientsWorkspace"))return;
  host.classList.add("ll-clients-page");
  host.innerHTML=`
    <div id="clientsWorkspace" class="ll-clients-workspace" data-no-translate="true">
      <header class="ll-clients-header">
        <div><h1>Clientes</h1><p>Gestiona la información, búsqueda y seguimiento de tus clientes.</p></div>
        <button id="clientsFocusNew" class="ll-clients-primary" type="button">${svg("plus",15)}<span>Nuevo cliente</span></button>
      </header>

      <div class="ll-clients-layout">
        <section class="ll-clients-list-card">
          <div class="ll-clients-card-head"><h2>Lista de clientes</h2></div>
          <div class="ll-clients-toolbar">
            <label class="ll-clients-search">${svg("search",15)}<input id="clientsSearch" type="search" placeholder="Buscar cliente por nombre, teléfono o nota..." /></label>
            <select id="clientsSort" aria-label="Ordenar clientes">
              <option value="name">Ordenar por: Nombre</option>
              <option value="recent">Más recientes</option>
              <option value="activity">Actividad reciente</option>
            </select>
            <div class="ll-clients-view-toggle">
              <button type="button" data-client-view="list" class="active" aria-label="Vista de lista">${svg("list",15)}</button>
              <button type="button" data-client-view="grid" aria-label="Vista de cuadrícula">${svg("grid",15)}</button>
            </div>
          </div>
          <div class="ll-clients-filters">
            <button type="button" data-client-filter="all" class="active">Todos</button>
            <button type="button" data-client-filter="recent">Recientes</button>
            <button type="button" data-client-filter="phone">Con teléfono</button>
            <button type="button" data-client-filter="no-phone">Sin teléfono</button>
          </div>
          <div id="clientsTableHead" class="ll-clients-table-head"><span>Cliente</span><span>Teléfono</span><span>Notas</span><span>Última actividad</span><span></span></div>
          <div id="clientsList" class="ll-clients-list"><div class="ll-clients-loading">Cargando clientes...</div></div>
          <footer class="ll-clients-pagination"><span id="clientsResultCount">—</span><div><button id="clientsPrev" type="button">‹</button><span id="clientsPageNumber">1</span><button id="clientsNext" type="button">›</button></div></footer>
        </section>

        <aside class="ll-clients-side">
          <section class="ll-client-add-card">
            <div class="ll-clients-card-head"><h2>Agregar cliente</h2><span class="ll-client-add-icon">${svg("user",16)}</span></div>
            <form id="clientsAddForm" class="ll-client-add-form">
              <label><span>Nombre completo del cliente</span><input id="clientsNewName" autocomplete="off" placeholder="Ej. Juan Pérez" required /></label>
              <label><span>Teléfono <small>(opcional)</small></span><input id="clientsNewPhone" autocomplete="off" placeholder="Ej. 809-555-1234" /></label>
              <label><span>Notas</span><textarea id="clientsNewNotes" rows="4" placeholder="Información adicional sobre el cliente..."></textarea></label>
              <button class="ll-client-add-submit" type="submit">${svg("user",15)} Agregar cliente</button>
              <div id="clientsAddStatus" class="ll-client-add-status"></div>
            </form>
          </section>

          <section class="ll-client-activity-card">
            <div class="ll-clients-card-head"><h2>Actividad reciente</h2><span class="ll-client-activity-icon">${svg("clock",16)}</span></div>
            <div id="clientsRecentActivity" class="ll-client-recent-activity"><div class="ll-clients-loading compact">Cargando...</div></div>
            <button id="clientsViewActivity" class="ll-client-activity-link" type="button">Ver toda la actividad <span>→</span></button>
          </section>
        </aside>
      </div>
    </div>`;
  wireClientsPage();
}

function wireClientsPage(){
  const root=qs("clientsWorkspace");
  if(!root||root.dataset.bound==="1")return;
  root.dataset.bound="1";
  root.addEventListener("click",event=>{
    const row=event.target.closest("[data-client-id]");
    if(row){window.dispatchEvent(new CustomEvent("loan-ledger:open-account",{detail:{borrowerId:row.dataset.clientId}}));return;}
    const filterBtn=event.target.closest("[data-client-filter]");
    if(filterBtn){filter=filterBtn.dataset.clientFilter;page=1;renderClients();return;}
    const viewBtn=event.target.closest("[data-client-view]");
    if(viewBtn){view=viewBtn.dataset.clientView;renderClients();return;}
    if(event.target.closest("#clientsFocusNew")){qs("clientsNewName")?.focus();return;}
    if(event.target.closest("#clientsPrev")){if(page>1){page--;renderClients();}return;}
    if(event.target.closest("#clientsNext")){page++;renderClients();return;}
    if(event.target.closest("#clientsViewActivity")){qs("menuActivity")?.click();return;}
  });
  qs("clientsSearch").addEventListener("input",()=>{page=1;renderClients();});
  qs("clientsSort").addEventListener("change",event=>{sort=event.target.value;page=1;renderClients();});
  qs("clientsAddForm").addEventListener("submit",addClient);
}

async function loadData(force=false){
  ensureClientsDom();
  if(!isClientsPage()||loading)return;
  if(!force&&Date.now()-lastLoadAt<15000&&borrowers.length){renderClients();renderRecentActivity();return;}
  loading=true;
  try{
    const [borrowerRes,accountRes,activityRes]=await Promise.all([
      supabase.from("borrowers").select("id,full_name,phone,notes,created_at").order("created_at",{ascending:false}),
      supabase.from("borrower_account_summary").select("borrower_id,account_status,principal_balance,last_payment_date"),
      supabase.from("activity_log_view").select("*").order("created_at",{ascending:false}).limit(250)
    ]);
    if(borrowerRes.error)throw borrowerRes.error;
    if(accountRes.error)throw accountRes.error;
    if(activityRes.error)throw activityRes.error;
    borrowers=borrowerRes.data||[];
    accountMap=new Map((accountRes.data||[]).map(row=>[String(row.borrower_id),row]));
    activityRows=(activityRes.data||[]).filter(row=>row.borrower_id);
    activityByBorrower=new Map();
    activityRows.forEach(row=>{const id=String(row.borrower_id);if(!activityByBorrower.has(id))activityByBorrower.set(id,row);});
    lastLoadAt=Date.now();
    renderClients();
    renderRecentActivity();
  }catch(error){
    console.error("clients workspace load failed",error);
    if(qs("clientsList"))qs("clientsList").innerHTML=`<div class="ll-clients-empty">${esc(error.message||error)}</div>`;
  }finally{loading=false;}
}

function filteredBorrowers(){
  const term=String(qs("clientsSearch")?.value||"").trim().toLowerCase();
  const recentCutoff=Date.now()-30*86400000;
  let rows=borrowers.filter(b=>{
    if(filter==="phone"&&!b.phone)return false;
    if(filter==="no-phone"&&b.phone)return false;
    if(filter==="recent"&&(!latestActivityDate(b)||latestActivityDate(b).getTime()<recentCutoff))return false;
    if(term){const hay=[b.full_name,b.phone,b.notes].map(v=>String(v||"").toLowerCase()).join(" ");if(!hay.includes(term))return false;}
    return true;
  });
  rows=[...rows].sort((a,b)=>{
    if(sort==="recent")return new Date(b.created_at||0)-new Date(a.created_at||0);
    if(sort==="activity")return (latestActivityDate(b)?.getTime()||0)-(latestActivityDate(a)?.getTime()||0);
    return String(a.full_name||"").localeCompare(String(b.full_name||""),"es",{sensitivity:"base"});
  });
  if(sort==="activity")rows.reverse();
  return rows;
}
function renderClients(){
  const host=qs("clientsList");if(!host)return;
  document.querySelectorAll("[data-client-filter]").forEach(btn=>btn.classList.toggle("active",btn.dataset.clientFilter===filter));
  document.querySelectorAll("[data-client-view]").forEach(btn=>btn.classList.toggle("active",btn.dataset.clientView===view));
  const head=qs("clientsTableHead");if(head)head.hidden=view!=="list";
  host.classList.toggle("grid-view",view==="grid");
  const rows=filteredBorrowers();
  const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  page=Math.min(Math.max(1,page),totalPages);
  const start=(page-1)*PAGE_SIZE;
  const visible=rows.slice(start,start+PAGE_SIZE);
  host.innerHTML=visible.length?visible.map(view==="grid"?clientGridHtml:clientRowHtml).join(""):`<div class="ll-clients-empty">No hay clientes para esta vista.</div>`;
  qs("clientsResultCount").textContent=rows.length?`Mostrando ${start+1}–${Math.min(start+PAGE_SIZE,rows.length)} de ${rows.length} clientes`:"0 clientes";
  qs("clientsPageNumber").textContent=String(page);
  qs("clientsPrev").disabled=page<=1;
  qs("clientsNext").disabled=page>=totalPages;
}
function clientRowHtml(b){
  const account=accountMap.get(String(b.id));
  const activity=latestActivityDate(b);
  return `<button class="ll-client-row" type="button" data-client-id="${esc(b.id)}">
    <span class="ll-client-person"><i class="tone-${avatarTone(b.full_name)}">${esc(initials(b.full_name))}<b class="${statusTone(account)}"></b></i><strong>${esc(b.full_name||"Sin nombre")}</strong></span>
    <span class="ll-client-phone">${svg("phone",13)} ${b.phone?esc(b.phone):"—"}</span>
    <span class="ll-client-notes">${b.notes?esc(b.notes):"Sin notas"}</span>
    <span class="ll-client-last">${esc(fmtDate(activity))}</span>
    <span class="ll-client-chevron">${svg("chevron",15)}</span>
  </button>`;
}
function clientGridHtml(b){
  const account=accountMap.get(String(b.id));
  const activity=latestActivityDate(b);
  return `<button class="ll-client-grid-card" type="button" data-client-id="${esc(b.id)}"><div class="ll-client-grid-top"><i class="tone-${avatarTone(b.full_name)}">${esc(initials(b.full_name))}<b class="${statusTone(account)}"></b></i><span>${svg("chevron",15)}</span></div><strong>${esc(b.full_name||"Sin nombre")}</strong><small>${b.phone?esc(b.phone):"Sin teléfono"}</small><p>${b.notes?esc(b.notes):"Sin notas"}</p><footer>Última actividad · ${esc(fmtDate(activity))}</footer></button>`;
}
function avatarTone(name){return [...String(name||"")].reduce((sum,c)=>sum+c.charCodeAt(0),0)%6;}

function activityLabel(action){
  const key=String(action||"").toUpperCase();
  if(key.includes("CLIENT_CREATED"))return "Nuevo cliente agregado";
  if(key.includes("CLIENT_EDITED"))return "Cliente actualizado";
  if(key.includes("PAYMENT"))return "Pago registrado";
  if(key.includes("FOLLOWUP"))return "Seguimiento actualizado";
  if(key.includes("CONTACT"))return "Nota de contacto";
  if(key.includes("DISBURSEMENT"))return "Desembolso actualizado";
  return String(action||"Actividad").replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function activityIcon(action){
  const key=String(action||"").toUpperCase();
  if(key.includes("PAYMENT"))return "payment";
  if(key.includes("EDIT"))return "edit";
  if(key.includes("CONTACT")||key.includes("FOLLOWUP"))return "note";
  return "user";
}
function renderRecentActivity(){
  const host=qs("clientsRecentActivity");if(!host)return;
  const rows=activityRows.slice(0,4);
  host.innerHTML=rows.length?rows.map(row=>`<button type="button" ${row.borrower_id?`data-client-id="${esc(row.borrower_id)}"`:""}><span class="ll-activity-bubble ${activityIcon(row.action_type)}">${svg(activityIcon(row.action_type),15)}</span><span><small>${esc(activityLabel(row.action_type))}</small><strong>${esc(row.borrower_name||row.entity_text||"Cliente")}</strong></span><time>${esc(fmtDate(row.created_at))}</time></button>`).join(""):`<div class="ll-clients-empty small">No hay actividad reciente.</div>`;
}

async function addClient(event){
  event.preventDefault();
  const status=qs("clientsAddStatus");
  const name=qs("clientsNewName")?.value.trim();
  const phone=qs("clientsNewPhone")?.value.trim()||null;
  const notes=qs("clientsNewNotes")?.value.trim()||null;
  if(!name){status.textContent="El nombre es requerido.";status.className="ll-client-add-status error";return;}
  try{
    status.textContent="Guardando cliente...";status.className="ll-client-add-status";
    const {data:userData,error:userError}=await supabase.auth.getUser();
    if(userError)throw userError;
    const userId=userData.user?.id;if(!userId)throw new Error("No se encontró una sesión activa.");
    const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("user_id",userId).maybeSingle();
    if(profileError)throw profileError;
    if(!["ADMIN","AGENT"].includes(profile?.role))throw new Error("Solo Admin/Agente puede agregar clientes.");
    const {error}=await supabase.from("borrowers").insert({full_name:name,phone,notes,created_by:userId});
    if(error)throw error;
    qs("clientsAddForm").reset();
    status.textContent="Cliente agregado correctamente.";status.className="ll-client-add-status success";
    borrowers=[];lastLoadAt=0;
    await loadData(true);
  }catch(error){
    console.error("add client failed",error);
    status.textContent=error.message||String(error);status.className="ll-client-add-status error";
  }
}

function tick(){ensureClientsDom();if(isClientsPage())loadData(false);}
const pageNode=qs("borrowersPage");
if(pageNode)new MutationObserver(()=>setTimeout(tick,40)).observe(pageNode,{attributes:true,attributeFilter:["class"]});
setInterval(()=>{if(isClientsPage())loadData(false);},15000);
tick();

console.log("modern clients workspace active");
