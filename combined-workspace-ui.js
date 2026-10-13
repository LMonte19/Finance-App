import { readPageQuery, getPageSessionId } from './page-read-runtime.js?v=1';

export const qs=id=>document.getElementById(id);
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
export const percent=value=>`${new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(Number(value||0)*100)}%`;
export const roleName=role=>({ADMIN:'Administrador',AGENT:'Agente',PARTNER:'Socio'}[role]||'Sin rol');
export const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
export const isoDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const today=()=>isoDate(new Date());
export function dateLabel(value,options={day:'2-digit',month:'short',year:'numeric'}){
  if(!value)return '—';const d=new Date(String(value).length===10?value+'T00:00:00':value);
  return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('es',options).replace('.','');
}
const icons={
  users:'<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2-6 5-6s5 2 5 6M15 14c3 0 5 2 5 6"/>',
  wallet:'<path d="M4 7h15v13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M16 11h4v5h-4a2.5 2.5 0 0 1 0-5Z"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M15 8c-1-1-5-1-5 1 0 3 5 1 5 4 0 3-4 3-6 1M12 5v14"/>',
  chart:'<path d="M4 4v16h16M8 15l4-5 3 2 5-6"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  edit:'<path d="m5 16 11-11 3 3L8 19l-4 1zM14 7l3 3"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',plus:'<path d="M12 4v16M4 12h16"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',check:'<path d="m5 12 4 4L19 6"/>',alert:'<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>'
};
export function icon(name){return `<svg class="cw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.chart}</svg>`;}
export function kpi(label,value,note,name='wallet',tone='purple'){return `<article class="cw-kpi"><div class="cw-kpi-main"><span class="cw-kpi-icon ${tone}">${icon(name)}</span><div><small>${esc(label)}</small><strong>${esc(value)}</strong></div></div><div class="cw-kpi-foot">${esc(note)}</div></article>`;}
export const empty=message=>`<div class="cw-empty">${esc(message)}</div>`;
export function openPage(id){const target={profilesPage:'partnersPage',reportsPage:'activityPage'}[id]||id;document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active-page',page.id===target));document.querySelectorAll('.tab-btn').forEach(tab=>tab.classList.toggle('active',tab.dataset.page===target));qs('sideMenu')?.classList.remove('open');qs('menuOverlay')?.classList.remove('open');}
export async function readViewer(db,force=false){const id=getPageSessionId();if(!id)return null;const {data,error}=await readPageQuery('my-profile:'+id,()=>db.from('profiles').select('*').eq('user_id',id).maybeSingle(),{force});if(error)throw error;return data;}
