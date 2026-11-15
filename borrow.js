const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => '₹' + Number(value || 0).toLocaleString('en-IN');
let initialPortal = 'rentals';
try { if (sessionStorage.getItem('nl-portal') === 'services') initialPortal = 'services'; } catch {}
const state = {items:[], saved:[], user:null, location:null, area:'', view:'rentals', portal:initialPortal, activity:{saved:[],threads:[],listings:[]}, threadId:null, messages:[], category:'all', query:'', sort:'near', selected:null, radius:10, loading:true, filtered:false,weekend:false,budget:false};
const categories = [['all','All gear'],['tools','Tools'],['tech','Tech & camera'],['outdoors','Outdoors']];
const group = {'Tools':'tools','Tech & Camera':'tech','Outdoors':'outdoors'};
const examples = [
  {id:-1,kind:'gear',title:'Digital camera kit',category:'Tech & Camera',area:'Example',description:'A camera kit could look like this.',price:900,photo:'/examples/camera.jpg',sample:true},
  {id:-2,kind:'gear',title:'Two-person camping tent',category:'Outdoors',area:'Example',description:'A camping tent could look like this.',price:400,photo:'/examples/tent.jpg',sample:true}
];
const send = (action, id, filters) => parent.postMessage({source:'neighbourlink-borrow',action,id,filters},location.origin);
const icon = name => '<svg class="ic"><use href="#i-' + name + '"/></svg>';

function distance(item) {
  if (!state.location || item.latitude == null || item.longitude == null) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const latitude = radians(item.latitude - state.location.latitude);
  const longitude = radians(item.longitude - state.location.longitude);
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(radians(state.location.latitude)) *
    Math.cos(radians(item.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1,a)));
}
function visibleItems() {
  const source = state.filtered ? state.items.filter(item=>item.kind==='gear') : state.items.some(item => item.kind === 'gear') ? state.items : examples;
  let rows = source.filter(item => item.kind === 'gear' && item.active !== false &&
    (state.category === 'all' || group[item.category] === state.category) &&
    [item.title,item.description,item.area,item.category].some(value => String(value || '').toLowerCase().includes(state.query)));
  if (state.location) rows = rows.filter(item => item.sample || (distance(item) != null && distance(item) <= state.radius));
  rows.sort((a,b) => state.sort === 'price' ? a.price - b.price :
    state.sort === 'near' && state.location && !a.sample ? distance(a) - distance(b) : b.id - a.id);
  return rows;
}
function art(item, extras = '') {
  return '<div class="art">' + (item.sample ? '<img loading="lazy" src="' + item.photo + '" alt="Example ' + escapeHtml(item.title) + '">' :
    item.hasPhoto ? '<img loading="lazy" src="/photos/' + item.id + '" alt="' + escapeHtml(item.title) + '">' :
    '<div class="no-photo">No photo uploaded</div>') + extras + (item.sample ? '<span class="tag">Example listing</span>' : '') + '</div>';
}
function render() {
  if (typeof renderChrome === 'function') renderChrome();
  document.querySelector('.quick-filters').hidden=state.view!=='rentals';
  if (state.view !== 'rentals' && typeof renderPortal === 'function') return renderPortal();
  $('weekend-filter').setAttribute('aria-pressed',String(state.weekend));$('budget-filter').setAttribute('aria-pressed',String(state.budget));
  const rows = visibleItems();
  const allGear = (state.filtered ? state.items : state.items.some(item => item.kind === 'gear') ? state.items : examples).filter(item => item.kind === 'gear' && item.active !== false);
  $('chips').innerHTML = categories.map(([key,label]) => '<button class="chip" type="button" data-category="' + key +
    '" aria-pressed="' + (state.category === key) + '">' + label + ' <em>' +
    allGear.filter(item => key === 'all' || group[item.category] === key).length + '</em></button>').join('');
  $('count').textContent = state.loading ? 'Loading local gear…' : rows.length +
    (allGear[0]?.sample ? ' photo examples · no live gear yet' : (rows.length === 1 ? ' item' : ' items') +
    (state.location ? ' within ' + state.radius + ' km' : ' available nearby'));
  $('grid').innerHTML = rows.length ? rows.map(item => '<article class="card" tabindex="0" data-item="' + item.id +
    '" aria-selected="' + (state.selected === item.id) + '">' + art(item, item.sample ? '' :
    '<button class="heart" type="button" data-save="' + item.id + '" aria-pressed="' + state.saved.includes(item.id) +
    '" aria-label="' + (state.saved.includes(item.id) ? 'Remove saved ' : 'Save ') + escapeHtml(item.title) + '">' + icon('heart') + '</button>') +
    '<div class="cb"><h3>' + escapeHtml(item.title) + '</h3><div class="meta">' + icon('pin') + escapeHtml(item.area) +
    (distance(item) == null ? '' : ' · ' + distance(item).toFixed(1) + ' km') + '</div><p>' + escapeHtml(item.description) +
    '</p><div class="owner-rating">'+escapeHtml(item.name||'Neighbour')+' · '+(item.owner_rating==null?'New owner':Number(item.owner_rating).toFixed(1)+' / 5 · '+Number(item.rating_count||0)+' reviews')+'</div></div><div class="cf"><div class="price">' + money(item.price) + ' <small>/ day</small></div></div>' +
    '<div class="card-actions">' + (item.sample ? '<button class="btn pri" type="button" data-list="1">List real gear</button>' : state.user?.id === item.owner ? '<button class="btn" type="button" disabled>Your listing</button>' :
    '<button class="btn pri" type="button" data-request="' + item.id + '">Request to borrow</button>') + '</div></article>').join('') :
    '<div class="empty"><h3>' + (state.loading ? 'Loading gear' : 'No gear found') + '</h3><p>' +
    (state.loading ? 'Checking local listings.' : 'Try another search or ask neighbours to list an item.') + '</p></div>';
  const savedGear = state.items.filter(item => item.kind === 'gear' && state.saved.includes(item.id)).length;
  $('savedN').hidden = savedGear === 0;
  $('savedN').textContent = savedGear;
  const selected = rows.find(item => item.id === state.selected) || rows[0];
  state.selected = selected?.id ?? null;
  $('detail').innerHTML = selected ? art(selected) + '<div class="dd"><h2>' + escapeHtml(selected.title) + '</h2>' +
    '<div class="price">' + money(selected.price) + ' <small>/ day</small></div><p>' + escapeHtml(selected.description) + '</p>' +
    (selected.owner_rating==null?'':'<div class="owner-rating">★ '+Number(selected.owner_rating).toFixed(1)+' owner rating · '+Number(selected.rating_count||0)+' review(s)</div>')+
    '<div class="owner"><div class="av">' + escapeHtml(selected.name?.slice(0,1).toUpperCase() || '?') +
    '</div><div><b>' + escapeHtml(selected.name || 'Neighbour') + '</b><small>Local owner</small></div></div>' +
    '<dl><dt>Pickup</dt><dd>' + escapeHtml(selected.area) + '</dd><dt>Distance</dt><dd>' +
    (distance(selected) == null ? 'Ask owner' : distance(selected).toFixed(1) + ' km') + '</dd></dl>' +
    (selected.sample ? '<button class="btn pri" type="button" data-list="1">List real gear</button>' : state.user?.id === selected.owner ? '<button class="btn" type="button" disabled>Your listing</button>' :
    '<button class="btn pri" type="button" data-request="' + selected.id + '">Request to borrow</button>') +
    (selected.sample ? '' : '<button class="btn" type="button" data-report="' + selected.id + '">Report listing</button>') + '</div>' : '';
  const name = state.user?.name || 'Guest';
  $('account-summary').innerHTML = '<div class="av">' + escapeHtml(name.slice(0,1).toUpperCase()) + '</div><div><b>' +
    escapeHtml(name) + '</b><small>' + (state.user ? 'My account' : 'Sign in to borrow') + '</small></div>';
  $('use-location').querySelector('b').textContent = state.area || 'Set my area';
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.source !== 'neighbourlink-app') return;
  const data = event.data;
  state.items = data.items || [];
  state.filtered=Boolean(data.filtered);
  state.activity = data.activity || {saved:[],threads:[],listings:[]};
  state.saved = state.activity.saved || [];
  state.user = data.user || null;
  state.location = data.location || null;
  state.area = data.area || '';
  if (state.view !== data.view) { state.query = ''; $('q').value = ''; state.category = 'all'; }
  state.view = data.view || 'rentals';
  if (['rentals','services'].includes(state.view)) {
    state.portal = state.view;
    try { sessionStorage.setItem('nl-portal',state.portal); } catch {}
  }
  state.threadId = data.threadId || null;
  state.messages = data.messages || [];
  document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light';
  state.loading = false;
  render();
});
document.addEventListener('click', event => {
  if (event.target.closest('a.brand')) { event.preventDefault(); send('navigate','landing'); return; }
  const navigation = event.target.closest('nav a[href^="/#"]');
  if (navigation) { event.preventDefault(); send('navigate',navigation.getAttribute('href').slice(2)); return; }
  const target = event.target.closest('[data-category],[data-item],[data-save],[data-request],[data-report],[data-list],[data-thread],[data-remove],[data-login],[data-logout],#list-item,#use-location');
  if (!target) return;
  if (target.dataset.category) { state.category = target.dataset.category; sendFilters(); }
  else if (target.dataset.save) { send('save',Number(target.dataset.save)); event.stopPropagation(); return; }
  else if (target.dataset.request) { send('request',Number(target.dataset.request)); event.stopPropagation(); return; }
  else if (target.dataset.report) { send('report',Number(target.dataset.report)); return; }
  else if (target.dataset.thread) {
    if (state.view === 'dashboard') send('navigate','messages');
    send('thread',Number(target.dataset.thread));
    return;
  }
  else if (target.dataset.remove) { send('remove',Number(target.dataset.remove)); return; }
  else if (target.dataset.login !== undefined) { send('login'); return; }
  else if (target.dataset.logout !== undefined) { send('logout'); return; }
  else if (target.id === 'list-item' || target.dataset.list) { send('list',state.portal); return; }
  else if (target.id === 'use-location') { send('location'); return; }
  else if (target.dataset.item) state.selected = Number(target.dataset.item);
  render();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('q').focus(); }
  if (event.key === 'Enter' && event.target.dataset?.item) { state.selected = Number(event.target.dataset.item); render(); }
});
$('q').addEventListener('input',event => { state.query = event.target.value.trim().toLowerCase(); render(); });
$('range').addEventListener('change',event => { state.radius = Number(event.target.value); render(); sendFilters(); });
$('sort').addEventListener('change',event => { state.sort = event.target.value; render(); sendFilters(); });
$('weekend-filter').onclick=()=>{state.weekend=!state.weekend;render();sendFilters();};
$('budget-filter').onclick=()=>{state.budget=!state.budget;render();sendFilters();};
function sendFilters() {
  let startDate=$('start-date').value,endDate=$('end-date').value;
  if(state.weekend){const saturday=new Date();saturday.setHours(12,0,0,0);saturday.setDate(saturday.getDate()+(6-saturday.getDay()+7)%7);const sunday=new Date(saturday);sunday.setDate(sunday.getDate()+1);const key=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');startDate=key(saturday);endDate=key(sunday);}
  const hint=$('filter-hint');
  if(Boolean(startDate)!==Boolean(endDate)) {hint.textContent='Choose both dates to filter availability.';return;}
  hint.textContent='';
  const selected=({tools:'Tools',tech:'Tech & Camera',outdoors:'Outdoors'})[state.category]||'all';
  send('filters',state.portal==='services'?'services':'rentals',{
    category:selected==='all'?'':selected,
    minPrice:$('min-price').value,maxPrice:state.budget?'499':$('max-price').value,
    startDate,endDate,
    minRating:$('min-rating').value,radius:state.radius,
    sort:state.sort==='near'?'nearest':state.sort
  });
}
$('apply-filters').addEventListener('click',sendFilters);
try { document.documentElement.dataset.theme = localStorage.getItem('nl-theme') || 'light'; } catch {}
$('theme').addEventListener('click',() => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('nl-theme',theme); } catch {}
});
render();
send('ready');
