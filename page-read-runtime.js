// Session-scoped, in-memory read cache. No account data is written to browser storage.
const reads = new Map();
const pages = new Map();
let owner = null;
let generation = 0;
let warmTimer = null;

function sessionChangedError() {
  const error = new Error('La sesión cambió durante la consulta.');
  error.code = 'STALE_PAGE_SESSION';
  return error;
}
export function isStalePageSession(error) { return error?.code === 'STALE_PAGE_SESSION'; }
export function getPageSessionId() { return owner; }
export function setPageSession(userId) {
  const next = userId || null;
  if (owner === next) return;
  owner = next;
  generation++;
  reads.forEach(entry => entry.controller?.abort());
  reads.clear();
  pages.forEach(page => page.reset?.());
  if (owner) scheduleWarmup();
}
export function invalidatePageReads() {
  generation++;
  reads.forEach(entry => entry.controller?.abort());
  reads.clear();
  setTimeout(() => pages.forEach(page => page.run?.()), 50);
}
export async function readPageQuery(key, loader, { force = false, ttl = 30000 } = {}) {
  const session = owner;
  const version = generation;
  if (!session) {
    const response = await loader();
    if (version !== generation) throw sessionChangedError();
    return response;
  }
  const existing = reads.get(key);
  if (!force && existing?.promise) return existing.promise;
  if (!force && existing?.response && existing.freshUntil > Date.now()) return existing.response;
  // A forced refresh after a write must not join a pre-write read.
  if (force && existing?.promise) existing.controller?.abort();
  const controller = new AbortController();
  const entry = { controller, response: existing?.response, freshUntil: 0, promise: null };
  reads.set(key, entry);
  entry.promise = (async () => {
    try {
      let query = loader();
      if (query?.abortSignal) query = query.abortSignal(controller.signal);
      const response = await query;
      if (version !== generation || owner !== session || reads.get(key) !== entry) throw sessionChangedError();
      if (reads.get(key) === entry) {
        if (response?.error) reads.delete(key);
        else { entry.response = response; entry.freshUntil = Date.now() + ttl; }
      }
      return response;
    } finally {
      if (reads.get(key) === entry) entry.promise = null;
    }
  })();
  return entry.promise;
}
export function loadingRows(count = 3) {
  return '<div class="ll-page-skeleton" aria-hidden="true">' +
    Array.from({length:count}, () => '<div><i></i><span><b></b><em></em></span></div>').join('') + '</div>';
}
export function fillInitialLoading(id, count = 3) {
  const node = document.getElementById(id);
  if (!node || node.children.length || !/^(Cargando|Loading)(?:[^a-z]|$)/i.test(node.textContent.trim())) return;
  node.innerHTML = loadingRows(count);
  node.setAttribute('aria-busy', 'true');
}
export function finishPageLoading(pageId) {
  document.querySelectorAll('#' + pageId + ' [aria-busy="true"]').forEach(node => node.removeAttribute('aria-busy'));
}
export function updatePageMarkup(page, html) {
  const heading = page.querySelector(':scope > .ll-ui-page-header');
  if (heading) heading.remove();
  page.innerHTML = html;
  if (heading) page.prepend(heading);
}
function isSignedIn() {
  const app = document.getElementById('app');
  return !!owner && !!app && app.style.display !== 'none';
}
function isAvailable(id) {
  const source = document.querySelector('#sideMenu [data-page="' + id + '"]');
  return source && source.style.display !== 'none' && source.dataset.roleHidden !== 'true';
}
function warmPage(id) {
  const page = pages.get(id);
  if (!isSignedIn() || !isAvailable(id) || !page?.prefetch) return Promise.resolve();
  if (page.warming) return page.warming;
  page.warming = Promise.resolve().then(page.prefetch).catch(() => {}).finally(() => { page.warming = null; });
  return page.warming;
}
function scheduleWarmup() {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(async () => {
    const version = generation;
    const ids = [...pages.keys()].filter(isAvailable);
    // Two page loads at a time, after the initial screen has started loading.
    for (let index=0; index<ids.length; index+=2) {
      if (version !== generation || !isSignedIn()) return;
      await Promise.all(ids.slice(index,index+2).map(warmPage));
    }
  }, 700);
}
export function watchPage(id, refresh, { prefetch, reset, interval = 15000 } = {}) {
  const existing = pages.get(id);
  if (existing) {
    const previousRefresh = existing.refresh;
    existing.refresh = () => Promise.all([previousRefresh(), refresh()]);
    if (prefetch) { const previous = existing.prefetch; existing.prefetch = () => Promise.all([previous?.(), prefetch()]); }
    if (reset) { const previous = existing.reset; existing.reset = () => { previous?.(); reset(); }; }
    return;
  }
  const state = { refresh, prefetch, reset, warming: null, scheduled: false, observed: null };
  pages.set(id, state);
  const run = () => {
    if (state.scheduled) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      if (!isSignedIn() || !document.getElementById(id)?.classList.contains('active-page')) return;
      Promise.resolve(state.refresh()).catch(error => { if (!isStalePageSession(error)) console.error(error); });
    });
  };
  state.run = run;
  state.attach = () => {
    const node = document.getElementById(id);
    if (!node || state.observed === node) return;
    state.observer?.disconnect();
    state.observed = node;
    state.observer = new MutationObserver(run);
    state.observer.observe(node, {attributes:true,attributeFilter:['class']});
    run();
  };
  state.attach();
  setInterval(run, interval);
  scheduleWarmup();
}
const app = document.getElementById('app');
if (app) new MutationObserver(() => {
  pages.forEach(page => { page.attach?.(); page.run?.(); });
  if (isSignedIn()) scheduleWarmup();
}).observe(app, {childList:true,attributes:true,attributeFilter:['style']});
document.addEventListener('pointerover', event => {
  const target = event.target.closest?.('[data-page]');
  if (target && !target.hidden) warmPage(target.dataset.page);
});
document.addEventListener('focusin', event => {
  const target = event.target.closest?.('[data-page]');
  if (target && !target.hidden) warmPage(target.dataset.page);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pages.forEach(page => page.run?.());
});

