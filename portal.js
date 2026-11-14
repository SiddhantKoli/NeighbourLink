const serviceGroups = [['all','All help'],['home','Home repair'],['creative','Creative'],['lessons','Lessons']];
const serviceGroup = {'Home repair':'home','Creative':'creative','Lessons':'lessons'};
const serviceExamples = [
  {id:-3,kind:'help',title:'Bicycle tune-up',category:'Home repair',area:'Example',description:'A local repair service could look like this.',price:600,photo:'/examples/bicycle.jpg',sample:true}
];
const currentKind = () => state.portal === 'services' ? 'help' : 'gear';
const portalSaved = () => state.items.filter(item => item.kind === currentKind() && state.saved.includes(item.id));

function renderChrome() {
  const labels = {rentals:'Borrow',services:'Local help',saved:'Saved',messages:'Messages',dashboard:'My activity'};
  document.querySelectorAll('nav a[href^="/#"]').forEach(link => {
    link.hidden = !!link.dataset.portal && link.dataset.portal !== state.portal;
    if (link.getAttribute('href') === '/#' + state.view) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  $('use-location').querySelector('small').textContent = 'My area';
  $('use-location').querySelector('b').textContent = state.area || 'Set my area';
  $('savedN').hidden = !portalSaved().length;
  $('savedN').textContent = portalSaved().length;
  const name = state.user?.name || 'Guest';
  $('account-summary').innerHTML = '<div class="av">' + escapeHtml(name.slice(0,1).toUpperCase()) + '</div><div><b>' +
    escapeHtml(name) + '</b><small>' + (state.user ? 'My account' : 'Sign in to participate') + '</small></div>';
  $('q').placeholder = state.view === 'services' ? 'Search local help in your area' :
    state.view === 'saved' ? 'Search your saved listings' : 'Search gear in your area';
  document.querySelector('.top .search').hidden = ['messages','dashboard'].includes(state.view);
  $('range').hidden = !['rentals','services'].includes(state.view);
  $('sort').hidden = !['rentals','services','saved'].includes(state.view);
  $('list-item').innerHTML = icon('plus') + (state.portal === 'services' ? 'Offer a skill' : 'List an item');
  $('list-item').hidden = ['messages','dashboard'].includes(state.view);
  document.body.dataset.view = state.view;
  document.body.dataset.portal = state.portal;
  document.body.dataset.auth = state.user ? 'in' : 'out';
  $('count').closest('.head').querySelector('h1').textContent = labels[state.view] || 'Borrow';
  document.title = 'NeighbourLink: ' + (labels[state.view] || 'Borrow');
}

function portalCard(item) {
  const saved = state.saved.includes(item.id);
  const sample = !!item.sample;
  const action = sample ? '<button class="btn pri" type="button" data-list="1">Offer a real skill</button>' :
    state.user?.id === item.owner ? '<button class="btn" disabled>Your listing</button>' :
    '<button class="btn pri" type="button" data-request="' + item.id + '">' +
    (item.kind === 'help' ? 'Request local help' : 'Request to borrow') + '</button>';
  return '<article class="card" tabindex="0" data-item="' + item.id + '" aria-selected="' + (state.selected === item.id) + '">' +
    art(item,sample ? '' : '<button class="heart" type="button" data-save="' + item.id + '" aria-pressed="' + saved +
      '" aria-label="' + (saved ? 'Remove saved ' : 'Save ') + escapeHtml(item.title) + '">' + icon('heart') + '</button>') +
    '<div class="cb"><h3>' + escapeHtml(item.title) + '</h3><div class="meta">' + icon('pin') + escapeHtml(item.area) +
    (distance(item) == null ? '' : ' · ' + distance(item).toFixed(1) + ' km') + '</div><p>' + escapeHtml(item.description) +
    '</p></div><div class="cf"><div class="price">' + money(item.price) + ' <small>/ ' + (item.kind === 'help' ? 'job' : 'day') +
    '</small></div></div><div class="card-actions">' + action + '</div></article>';
}

function portalDetail(item) {
  if (!item) return '<div class="portal-aside-empty"><h2>Choose a listing</h2><p>Details will appear here.</p></div>';
  return art(item) + '<div class="dd"><h2>' + escapeHtml(item.title) + '</h2><div class="price">' + money(item.price) +
    ' <small>/ ' + (item.kind === 'help' ? 'job' : 'day') + '</small></div><p>' + escapeHtml(item.description) + '</p>' +
    '<div class="owner"><div class="av">' + escapeHtml(item.name?.slice(0,1).toUpperCase() || '?') +
    '</div><div><b>' + escapeHtml(item.name || 'Neighbour') + '</b><small>Local owner</small></div></div>' +
    '<dl><dt>Area</dt><dd>' + escapeHtml(item.area) + '</dd><dt>Category</dt><dd>' + escapeHtml(item.category) + '</dd></dl>' +
    (item.sample ? '<button class="btn pri" type="button" data-list="1">Offer a real skill</button>' :
      state.user?.id === item.owner ? '<button class="btn" disabled>Your listing</button>' :
      '<button class="btn pri" type="button" data-request="' + item.id + '">' +
      (item.kind === 'help' ? 'Request local help' : 'Request to borrow') + '</button>') +
    (item.sample ? '' : '<button class="btn" type="button" data-report="' + item.id + '">Report listing</button>') + '</div>';
}

function renderServiceOrSaved() {
  const services = state.view === 'services';
  const liveServices = state.items.filter(item => item.kind === 'help');
  const source = services ? (liveServices.length ? liveServices : serviceExamples) : portalSaved();
  const rows = source.filter(item =>
    (!services || state.category === 'all' || serviceGroup[item.category] === state.category) &&
    [item.title,item.area,item.description,item.category].some(value => String(value || '').toLowerCase().includes(state.query)) &&
    (!state.location || !services || item.sample || (distance(item) != null && distance(item) <= state.radius)));
  rows.sort((a,b) => state.sort === 'price' ? a.price - b.price :
    state.sort === 'near' && state.location && !a.sample ? distance(a) - distance(b) : b.id - a.id);
  $('chips').innerHTML = services ? serviceGroups.map(([key,label]) => '<button class="chip" data-category="' + key +
    '" aria-pressed="' + (state.category === key) + '">' + label + ' <em>' +
    source.filter(item => key === 'all' || serviceGroup[item.category] === key).length + '</em></button>').join('') : '';
  $('count').textContent = state.loading ? 'Loading…' : services && !liveServices.length ?
    '1 photo example · no live services yet' : rows.length + (rows.length === 1 ? ' listing' : ' listings') +
    (services && state.location ? ' within ' + state.radius + ' km' : '');
  $('grid').innerHTML = rows.length ? rows.map(portalCard).join('') :
    '<div class="empty"><h3>' + (services ? 'No local help found' : 'Nothing saved yet') + '</h3><p>' +
    (services ? 'Try another search or offer your skill.' : state.user ? 'Save a listing to keep it close.' : 'Sign in to save listings.') +
    '</p>' + (state.user ? '' : '<button class="btn pri" data-login>Sign in</button>') + '</div>';
  const selected = rows.find(item => item.id === state.selected) || rows[0];
  state.selected = selected?.id ?? null;
  $('detail').innerHTML = portalDetail(selected);
}

function renderMessages() {
  const threads = (state.activity.threads || []).filter(thread => thread.kind === currentKind());
  $('chips').innerHTML = '';
  $('count').textContent = state.user ? (state.portal === 'services' ? 'Local help · ' : 'Borrow · ') + threads.length + (threads.length === 1 ? ' conversation' : ' conversations') :
    'Sign in to see your conversations';
  $('grid').innerHTML = threads.length ? '<div class="portal-list">' + threads.map(thread =>
    '<button class="portal-row" type="button" data-thread="' + thread.id + '" aria-current="' + (thread.id === state.threadId) +
    '"><span class="portal-row-title">' + escapeHtml(thread.title) + '</span><span>' +
    escapeHtml(thread.owner === state.user?.id ? thread.requesterName : thread.ownerName) + '</span><span class="portal-badge">' +
    escapeHtml(thread.status) + '</span></button>').join('') + '</div>' :
    '<div class="empty"><h3>No conversations yet</h3><p>' + (state.user ? 'Request an item or service to start one.' : 'Sign in to see your messages.') +
    '</p><button class="btn pri" data-' + (state.user ? 'navigate="' + state.portal + '"' : 'login') + '>' + (state.user ? state.portal === 'services' ? 'Find local help' : 'Browse gear' : 'Sign in') + '</button></div>';
  const thread = threads.find(row => row.id === state.threadId);
  $('detail').innerHTML = thread ? '<div class="portal-chat"><div class="portal-chat-head"><h2>' + escapeHtml(thread.title) +
    '</h2><span class="portal-badge">' + escapeHtml(thread.status) + '</span><small>' +
    escapeHtml(thread.owner === state.user?.id ? thread.requesterName : thread.ownerName) + '</small></div>' +
    '<div class="portal-messages">' + (state.messages.length ? state.messages.map(message =>
      '<div class="portal-bubble' + (message.sender === state.user?.id ? ' mine' : '') + '">' + escapeHtml(message.body) + '</div>').join('') :
      '<p>No messages yet. Send the first one.</p>') + '</div><form id="portal-compose" class="portal-compose"><input name="message" maxlength="2000" required aria-label="Write a message" placeholder="Write a message"><button class="btn pri">Send</button></form></div>' :
    '<div class="portal-aside-empty"><h2>Choose a conversation</h2><p>Your messages will appear here.</p></div>';
}

function renderDashboard() {
  const listings = (state.activity.listings || []).filter(item => item.kind === currentKind());
  const requests = (state.activity.threads || []).filter(thread => thread.kind === currentKind());
  $('chips').innerHTML = '';
  $('count').textContent = state.user ? (state.portal === 'services' ? 'Your local help activity' : 'Your borrowing activity') : 'Sign in to see your activity';
  if (!state.user) {
    $('grid').innerHTML = '<div class="empty"><h3>Your activity starts here</h3><p>Sign in to manage listings and requests.</p><button class="btn pri" data-login>Sign in</button></div>';
    $('detail').innerHTML = '';
    return;
  }
  $('grid').innerHTML = '<div class="portal-dashboard"><div class="portal-stats"><div><strong>' + listings.length +
    '</strong><span>Your listings</span></div><div><strong>' + requests.length + '</strong><span>Requests</span></div><div><strong>' +
    portalSaved().length + '</strong><span>Saved</span></div></div><div class="portal-section-head"><h2>Your listings</h2><button class="btn pri" data-list="1">' +
    (state.portal === 'services' ? 'Offer a skill' : 'List an item') + '</button></div>' +
    (listings.length ? listings.map(item => '<div class="portal-record"><div><b>' + escapeHtml(item.title) + '</b><small>' +
      escapeHtml(item.category) + ' · ' + (item.active ? 'Published' : 'Unpublished') + '</small></div>' +
      (item.active ? '<button class="btn" data-remove="' + item.id + '">Unpublish</button>' : '') + '</div>').join('') :
      '<p class="portal-muted">You have not listed anything yet.</p>') + '<div class="portal-section-head"><h2>Your requests</h2></div>' +
    (requests.length ? requests.map(thread => '<button class="portal-record" data-thread="' + thread.id + '"><div><b>' +
      escapeHtml(thread.title) + '</b><small>' + escapeHtml(thread.status) + '</small></div><span>Open conversation</span></button>').join('') :
      '<p class="portal-muted">No requests yet.</p>') + '</div>';
  $('detail').innerHTML = '<div class="dd"><h2>' + escapeHtml(state.user.name) + '</h2><p>Manage your account and local activity.</p>' +
    '<button class="btn" data-logout>Sign out</button></div>';
}

function renderPortal() {
  $('count').closest('.head').querySelector('h1').textContent =
    {services:'Local help',saved:'Saved',messages:'Messages',dashboard:'My activity'}[state.view] || 'Borrow';
  if (['services','saved'].includes(state.view)) renderServiceOrSaved();
  else if (state.view === 'messages') renderMessages();
  else if (state.view === 'dashboard') renderDashboard();
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-navigate]');
  if (button) send('navigate',button.dataset.navigate);
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'portal-compose') return;
  event.preventDefault();
  const input = event.target.elements.message;
  const text = input.value.trim();
  if (!text) return;
  parent.postMessage({source:'neighbourlink-borrow',action:'message',text},location.origin);
  input.value = '';
});
