const $ = selector => document.querySelector(selector);
const empty = text => '<div class="empty">' + text + '</div>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const categories = { gear: ['Tools','Tech & Camera','Outdoors'], help: ['Home repair','Creative','Lessons'] };
const groups = { Tools:'tools', 'Tech & Camera':'tech', Outdoors:'outdoors', 'Home repair':'home', Creative:'creative', Lessons:'lessons' };
const filters = { home:'all', rentals:'all', services:'all' };
const views = ['landing','home','rentals','services','saved','messages','dashboard','login','profile'];
const examples = [
  { kind:'gear', title:'Digital camera kit', category:'Tech & Camera', area:'Indiranagar, Bengaluru', description:'Camera with lens and strap for a weekend shoot.', price:900, photo:'camera' },
  { kind:'gear', title:'Two-person camping tent', category:'Outdoors', area:'Domlur, Bengaluru', description:'Compact tent for a short camping trip.', price:400, photo:'tent' },
  { kind:'help', title:'Bicycle tune-up', category:'Home repair', area:'Indiranagar, Bengaluru', description:'Brake and gear adjustment for everyday bicycles.', price:600, photo:'bicycle' }
];
function exampleCard(item) {
  return '<article class="card"><div class="card-art"><img class="nl-photo" loading="lazy" src="/examples/' + item.photo +
    '.jpg" alt="' + escape(item.title) + '"><span class="tag">EXAMPLE LISTING</span></div><div class="card-body"><h3>' +
    escape(item.title) + '</h3><div class="meta">' + escape(item.area) + '</div><p class="nl-description">' +
    escape(item.description) + '</p></div><div class="card-foot"><div class="price"><strong>₹' + item.price +
    '</strong> ' + (item.kind === 'gear' ? '/ DAY' : '/ JOB') + '</div></div></article>';
}
let view = 'landing';
let user = null;
let items = [];
let activity = { saved:[], threads:[], listings:[], reports:[] };
let threadId = null;
let query = '';
let visitorLocation = null;
let visitorArea = '';
let activeMessages = [];
let listingLocation = null;
let radius = 10;
function kilometres(item) {
  if (!visitorLocation || item.latitude == null || item.longitude == null) return null;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(item.latitude - visitorLocation.latitude);
  const dLon = radians(item.longitude - visitorLocation.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(visitorLocation.latitude)) *
    Math.cos(radians(item.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1,a)));
}
function locate(precision = 2) {
  return new Promise((resolve,reject) => {
    if (!navigator.geolocation) return reject(Error('Location is unavailable. Search by neighbourhood instead.'));
    navigator.geolocation.getCurrentPosition(position => resolve({
      latitude: Number(position.coords.latitude.toFixed(precision)),
      longitude: Number(position.coords.longitude.toFixed(precision))
    }), error => reject(Error(error.code === 1 ? 'Location access declined. Search by neighbourhood instead.' :
      'Could not find your location. Search by neighbourhood instead.')),
    {enableHighAccuracy:false,timeout:15000,maximumAge:300000});
  });
}
let afterSignIn;
let signInReturn = 'landing';
let toastTimer;
const accountButton = document.createElement('button');
accountButton.className = 'btn nl-account';
accountButton.textContent = 'Sign in';
$('.top-actions').prepend(accountButton);
$('.profile').innerHTML = '<div><button class="btn" data-go="dashboard">My account</button></div>';
$('.neighborhood').textContent = 'Neighbourhood marketplace';
$('.hero-stamp').remove();
$('#view-home .section-head p').textContent = 'Search by item, skill, or neighbourhood';
$('#global-search').placeholder = 'Item, skill, or neighbourhood';
$('#global-search').setAttribute('aria-label','Search marketplace');
$('[data-filter="sale"]').remove();
$('.stats').remove();
$('#view-dashboard .section-head').remove();
$('#view-dashboard .list').id = 'activity';
$('.threads').replaceChildren();
$('.chat-head').textContent = 'Choose a request';
$('#messages').replaceChildren();
$('#message-input').setAttribute('aria-label','Message');
$('#message-input').maxLength = 2000;
$('#toast').setAttribute('role','status');

function dialog(id, heading, fields) {
  const node = document.createElement('dialog');
  node.className = 'nl-dialog';
  node.id = id;
  node.setAttribute('aria-labelledby', id + '-title');
  node.innerHTML = '<h2 id="' + id + '-title">' + heading + '</h2><form>' + fields +
    '<p role="alert" class="nl-error"></p><div class="nl-controls"><button class="btn primary">Continue</button><button type="button" class="btn" data-close>Cancel</button></div></form>';
  node.querySelector('[data-close]').onclick = () => node.close();
  document.body.append(node);
  return node;
}
const authFields =
  '<label class="auth-field">Your name<input name="name" maxlength="80" autocomplete="name" placeholder="How should neighbours call you?"></label>' +
  '<label class="auth-field">Email address<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label>' +
  '<div class="auth-field"><label for="auth-password">Password</label><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password" placeholder="At least 12 characters"><button type="button" id="password-toggle" aria-label="Show password" aria-pressed="false">Show</button></div></div>';
const auth = $('#login-panel');
auth.innerHTML = '<div class="auth-heading"><span class="auth-eyebrow">WELCOME TO NEIGHBOURLINK</span><h1 id="account-dialog-title">Welcome back.</h1>' +
  '<p id="auth-intro">Sign in to share more with the people around you.</p></div><form>' + authFields +
  '<p role="alert" class="nl-error"></p><button class="btn primary auth-submit" type="submit">Sign in</button>' +
  '<p class="auth-switch"><span id="auth-switch-prompt">New around here?</span> <button type="button" id="auth-mode">Create an account</button></p></form>';
$('#password-toggle').onclick = () => {
  const field = $('#auth-password');
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  $('#password-toggle').textContent = visible ? 'Hide' : 'Show';
  $('#password-toggle').setAttribute('aria-label',visible ? 'Hide password' : 'Show password');
  $('#password-toggle').setAttribute('aria-pressed',String(visible));
};
$('#login-theme').onclick = () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  try { localStorage.setItem('nl-theme',next); } catch {}
};
$('#listing-modal').remove();
const listing = dialog('listing-dialog','Put it to use.',
  '<label class="nl-field">Title<input name="title" required maxlength="100"></label>' +
  '<label class="nl-field">Listing type<select name="kind"><option value="gear">Gear to borrow</option><option value="help">Local service</option></select></label>' +
  '<label class="nl-field">Category<select name="category"></select></label>' +
  '<label class="nl-field">Price in rupees<input name="price" type="number" min="0" max="10000000" step="1" required></label>' +
  '<label class="nl-field">Neighbourhood<input name="area" required maxlength="100" placeholder="e.g. Indiranagar, Bengaluru"></label>' +
  '<button type="button" class="btn" id="listing-location">Add approximate location</button>' +
  '<span id="listing-location-status">Optional. Your approximate location will be public.</span>' +
  '<label class="nl-field">Description<textarea name="description" required maxlength="1200" rows="3"></textarea></label>' +
  '<label class="nl-field">Listing photo (JPEG, PNG, or WebP, up to 1 MB)<input name="photo" type="file" required accept="image/jpeg,image/png,image/webp"><small>Use a clear photo of the actual item or an example of your own work.</small><img class="nl-upload-preview" alt="Your listing photo preview" hidden></label>');
const report = dialog('report-dialog','Report listing','<label class="nl-field">Reason<textarea name="reason" required maxlength="500" rows="3"></textarea></label>');
const review = dialog('review-dialog','Review your booking',
  '<label class="nl-field">Rating<select name="score"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label>' +
  '<label class="nl-field">Comment<textarea name="comment" maxlength="500"></textarea></label>');
submit(review, async form => {
  await api('/requests/' + threadId + '/rating','POST',{score:Number(form.get('score')),comment:form.get('comment')});
  review.close();
  review.querySelector('form').reset();
  await refresh();
  await openThread(threadId);
});
let reportedId;
let requestedListing;
const booking = dialog('booking-dialog','Send a request',
  '<label class="nl-field"><span id="booking-date-label">Start date</span><input name="startDate" type="date" required></label>' +
  '<label class="nl-field">Return date<input name="endDate" type="date"></label>' +
  '<label class="nl-field"><span id="booking-details-label">Details</span><textarea name="details" maxlength="1000" rows="3"></textarea></label>');
function openBooking(item) {
  const form = booking.querySelector('form');
  form.reset();
  requestedListing = item.id;
  const gear = item.kind === 'gear';
  $('#booking-dialog-title').textContent = gear ? 'Request gear rental' : 'Request local help';
  $('#booking-date-label').textContent = gear ? 'Pickup date' : 'Preferred appointment date';
  $('#booking-details-label').textContent = gear ? 'Pickup notes (optional)' : 'What do you need help with?';
  form.elements.startDate.min = new Date().toISOString().slice(0,10);
  form.elements.endDate.parentElement.style.display = gear ? '' : 'none';
  form.elements.endDate.required = gear;
  form.elements.details.required = !gear;
  form.elements.startDate.onchange = () => { form.elements.endDate.min = form.elements.startDate.value; };
  form.elements.endDate.min = form.elements.startDate.min;
  booking.querySelector('.primary').textContent = 'Send request';
  show(booking);
}
submit(booking, async form => {
  const {id} = await api('/requests/' + requestedListing,'PUT',Object.fromEntries(form));
  booking.close();
  threadId = id;
  await refresh();
  await navigate('messages');
});

async function api(path, method = 'GET', body) {
  const response = await fetch('/api/v1' + path, {
    method, headers: body ? { 'Content-Type':'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (response.status === 403 && path !== '/profile') { navigate('profile'); throw Error(data.error || 'Complete your profile to continue.'); }
  if (response.status === 401 && !['/login','/signup'].includes(path)) {
    user = null;
    items = [];
    activity = {saved:[],threads:[],listings:[],reports:[]};
    deactivateProtectedFrames();
    navigate('login');
  }
  if (!response.ok) throw Error(data.error || 'Request failed.');
  return data;
}
function toast(text) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 4000);
}
function submit(dialog, action) {
  const form = dialog.querySelector('form');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"], .primary');
    const error = form.querySelector('.nl-error');
    button.disabled = true;
    error.textContent = '';
    try { await action(new FormData(form)); }
    catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; }
  };
}
function show(dialog) {
  dialog.querySelector('.nl-error').textContent = '';
  dialog.showModal();
}
function renderAuth(signup) {
  auth.dataset.mode = signup ? 'signup' : 'login';
  $('#account-dialog-title').textContent = signup ? 'Join the neighbourhood.' : 'Welcome back.';
  $('#auth-intro').textContent = signup ? 'Create your account to borrow, offer help, and connect nearby.' : 'Sign in to share more with the people around you.';
  const name = auth.querySelector('[name="name"]');
  name.parentElement.hidden = !signup;
  name.parentElement.style.display = signup ? 'grid' : 'none';
  name.required = signup;
  auth.querySelector('[name="password"]').autocomplete = signup ? 'new-password' : 'current-password';
  auth.querySelector('.primary').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-switch-prompt').textContent = signup ? 'Already a member?' : 'New around here?';
  $('#auth-mode').textContent = signup ? 'Sign in' : 'Create an account';
  auth.querySelector('.nl-error').textContent = '';
}
function activateProtectedFrames() {
  document.querySelectorAll('iframe[data-src]').forEach(frame => {
    if (!frame.hasAttribute('src')) frame.src = frame.dataset.src;
  });
}
function deactivateProtectedFrames() {
  document.querySelectorAll('iframe[data-src]').forEach(frame => frame.removeAttribute('src'));
}
function requireUser(action) {
  if (user) return action();
  afterSignIn = action;
  renderAuth(false);
  signInReturn = view === 'login' ? 'home' : view;
  return navigate('login');
}
$('#auth-mode').onclick = () => renderAuth(auth.dataset.mode !== 'signup');
submit(auth, async form => {
  await api('/' + auth.dataset.mode, 'POST', Object.fromEntries(form));
  user = await api('/session');
  if (!user.profileComplete) {
    await navigate('profile');
    return;
  }
  activateProtectedFrames();
  const destination = signInReturn;
  auth.querySelector('form').reset();
  await refresh();
  const next = afterSignIn;
  afterSignIn = undefined;
  await navigate(destination);
  if (next) await next();
});
const profileForm = $('#profile-form');
profileForm.elements.name.value = '';
profileForm.addEventListener('submit',event => {
  event.preventDefault();
  const button = profileForm.querySelector('.auth-submit');
  button.disabled = true;
  $('#profile-error').textContent = '';
  perform(async () => {
    try {
      const file = profileForm.elements.photoFile.files[0];
      if (!file || file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPEG, PNG, or WebP face photo under 1 MB.');
      const photo = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('Could not read that photo.'));
        reader.readAsDataURL(file);
      });
      await api('/profile','PUT',{name:profileForm.elements.name.value,email:profileForm.elements.email.value,phone:profileForm.elements.phone.value,photo});
      user = await api('/session');
      activateProtectedFrames();
      await refresh();
      await navigate('landing');
    } catch(error) { $('#profile-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
});
profileForm.elements.photoFile.addEventListener('change',() => {
  const file = profileForm.elements.photoFile.files[0];
  const preview = $('#profile-preview');
  if (!file || file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) { preview.hidden = true; return; }
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});
$('#profile-theme').onclick = () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  try { localStorage.setItem('nl-theme',next); } catch {}
};
accountButton.onclick = () => perform(() => user ? navigate('dashboard') : requireUser(() => navigate('dashboard')));

function changeCategories() {
  const form = listing.querySelector('form');
  form.elements.category.replaceChildren(...categories[form.elements.kind.value].map(value => new Option(value)));
}
$('#listing-location').onclick = () => perform(async () => {
  listingLocation = await locate();
  $('#listing-location-status').textContent = 'Approximate location added.';
});
const photoInput = listing.querySelector('[name="photo"]');
const photoPreview = listing.querySelector('.nl-upload-preview');
let previewUrl;
function clearPhotoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  photoPreview.hidden = true;
  photoPreview.removeAttribute('src');
}
photoInput.onchange = () => {
  clearPhotoPreview();
  const file = photoInput.files[0];
  if (!file || file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) return;
  previewUrl = URL.createObjectURL(file);
  photoPreview.src = previewUrl;
  photoPreview.hidden = false;
};
listing.addEventListener('close',clearPhotoPreview);
listing.querySelector('[name="kind"]').onchange = changeCategories;
function openListing(kind) {
  listingLocation = null;
  $('#listing-location-status').textContent = 'Optional. Your approximate location will be public.';
  return requireUser(() => {
    const form = listing.querySelector('form');
    form.reset();
    form.elements.kind.value = kind;
    changeCategories();
    show(listing);
  });
}
submit(listing, async form => {
  const body = Object.fromEntries(form);
  const file = body.photo;
  body.price = Number(body.price);
  if (listingLocation) Object.assign(body,listingLocation);
  if (!file.size) throw Error('Choose a photo of the item or your work.');
  body.photo = '';
  if (file.size) {
    if (file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPEG, PNG, or WebP photo under 1 MB.');
    body.photo = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Could not read photo.'));
      reader.readAsDataURL(file);
    });
  }
  await api('/listings','POST',body);
  listing.close();
  query = '';
  const target = body.kind === 'gear' ? 'rentals' : 'services';
  filters[target] = 'all';
  await refresh();
  navigate(target);
  toast('Listing published.');
});
submit(report, async form => {
  await api('/reports/' + reportedId,'POST',{reason:form.get('reason')});
  report.close();
  report.querySelector('form').reset();
  toast('Report submitted.');
});

function card(item) {
  const saved = activity.saved.includes(item.id);
  return '<article class="card"><div class="card-art art-' + (item.kind === 'gear' ? 'tool' : 'drill') + '">' +
    (item.hasPhoto ? '<img class="nl-photo" loading="lazy" src="/photos/' + item.id + '" alt="' + escape(item.title) + '">' : '<span class="nl-no-photo">No photo uploaded</span>') +
    '<span class="tag">' + escape(item.category) + '</span><button class="heart" aria-label="' + (saved ? 'Remove from saved' : 'Save listing') + '" aria-pressed="' + saved + '" data-save="' + item.id + '">' + (saved ? '♥' : '♡') + '</button></div>' +
    '<div class="card-body"><h3>' + escape(item.title) + '</h3><div class="meta">⌖ ' + escape(item.area) + '</div><p class="nl-description">' + escape(item.description) + '</p><div class="owner">' + escape(item.name) + '</div></div>' +
    '<div class="card-foot"><div class="price"><strong>₹' + item.price.toLocaleString('en-IN') + '</strong> ' + (item.kind === 'gear' ? '/ DAY' : '/ JOB') + '</div>' +
    (item.owner === user?.id ? '' : '<button data-request="' + item.id + '">REQUEST →</button>') +
    '</div><button class="btn" data-report="' + item.id + '">Report</button></article>';
}
function render() {
  const available = [...items, ...examples.filter(example => !items.some(item => item.kind === example.kind))];
  let matches = available.filter(item => [item.title,item.category,item.area,item.name,item.description].some(text => text?.toLowerCase().includes(query)));
  if (visitorLocation) {
    matches = matches.filter(item => kilometres(item) != null && kilometres(item) <= radius);
    matches.sort((a,b) => kilometres(a) - kilometres(b));
  }
  document.querySelectorAll('.nearby-status').forEach(node => node.textContent =
    visitorLocation ? 'Showing listings within ' + radius + ' km, nearest first.' : 'Search by neighbourhood or use your location.');
  const grid = (id, rows, fallback) => { const node = $(id); if (node) node.innerHTML = rows.map(item => item.photo ? exampleCard(item) : card(item)).join('') || empty(fallback); };
  grid('#home-grid',matches.filter(item => filters.home === 'all' || item.kind === filters.home),'No matching listings.');
  grid('#rentals-grid',matches.filter(item => item.kind === 'gear' && (filters.rentals === 'all' || groups[item.category] === filters.rentals)),'No matching gear.');
  grid('#services-grid',matches.filter(item => item.kind === 'help' && (filters.services === 'all' || groups[item.category] === filters.services)),'No matching services.');
  grid('#saved-grid',items.filter(item => activity.saved.includes(item.id)),user ? 'Nothing saved yet.' : 'Sign in to see your shortlist.');
  $('#saved-count').textContent = activity.saved.length || '';
  accountButton.textContent = user ? 'My account' : 'Sign in';
  for (const [key,id] of Object.entries({home:'home-filters',rentals:'gear-filters',services:'service-filters'})) {
    document.querySelectorAll('#' + id + ' .chip').forEach(chip => chip.classList.toggle('active',chip.dataset.filter === filters[key]));
  }
  renderActivity();
  updateBorrow();
}
function updateBorrow() {
  const frame = $('.borrow-frame');
  let theme = 'light';
  try { theme = localStorage.getItem('nl-theme') || 'light'; } catch {}
  frame?.contentWindow?.postMessage({source:'neighbourlink-app',items,activity,user,location:visitorLocation,area:visitorArea,view,threadId,messages:activeMessages,theme},location.origin);
}
$('.borrow-frame').addEventListener('load',updateBorrow);
window.addEventListener('message',event => {
  if (event.origin !== location.origin || event.source !== $('.borrow-frame').contentWindow || event.data?.source !== 'neighbourlink-borrow') return;
  const {action,id} = event.data;
  perform(async () => {
    if (action === 'ready') return updateBorrow();
    if (action === 'login') { const destination = view; return requireUser(() => navigate(destination)); }
    if (action === 'navigate') {
      if (['saved','messages'].includes(id) && !user) return requireUser(() => navigate(id));
      if (id === 'messages' && user) await refresh();
      return navigate(id);
    }
    if (action === 'list') return openListing(id === 'services' ? 'help' : 'gear');
    if (action === 'location') {
      visitorArea = 'Finding your area…';
      updateBorrow();
      try { visitorLocation = await locate(3); }
      catch { visitorArea = 'Location access off'; updateBorrow(); return; }
      visitorArea = visitorLocation.latitude.toFixed(3) + ', ' + visitorLocation.longitude.toFixed(3);
      render();
      try {
        const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
        url.searchParams.set('latitude',visitorLocation.latitude);
        url.searchParams.set('longitude',visitorLocation.longitude);
        url.searchParams.set('localityLanguage','en');
        const response = await fetch(url);
        if (response.ok) {
          const place = await response.json();
          const parts = [place.locality,place.city].filter((part,index,list) => part && list.indexOf(part) === index);
          visitorArea = parts.join(', ') || place.principalSubdivision || visitorArea;
          updateBorrow();
        }
      } catch { toast('Showing your coordinates. Area name is unavailable.'); }
      return;
    }
    if (action === 'thread') return openThread(id);
    if (action === 'message') {
      if (!threadId || !event.data.text?.trim()) return;
      await api('/requests/' + threadId + '/messages','POST',{message:event.data.text.trim()});
      return openThread(threadId);
    }
    if (action === 'logout') { await api('/logout','POST'); user = null; threadId = null; activeMessages = []; items = []; deactivateProtectedFrames(); return navigate('login'); }
    if (action === 'remove' && confirm('Unpublish this listing?')) { await api('/listings/' + id,'DELETE'); return refresh(); }
    if (action === 'save') return requireUser(async () => {
      await api('/saved/' + id,activity.saved.includes(id) ? 'DELETE' : 'PUT');
      await refresh();
    });
    if (action === 'request') return requireUser(async () => {
      await refresh();
      const existing = activity.threads.find(thread => thread.listing === id && thread.requester === user.id);
      if (existing) { threadId = existing.id; return navigate('messages'); }
      const item = items.find(item => item.id === id);
      if (item) openBooking(item);
      else toast('Listing unavailable.');
    });
    if (action === 'report') return requireUser(() => { reportedId = id; show(report); });
  });
});
function renderActivity() {
  $('#activity').innerHTML = user ? '<div class="nl-controls"><strong>' + escape(user.name) + '</strong><button class="btn" data-logout>Sign out</button></div><h2>Your listings</h2>' +
    (activity.listings.map(item => '<div class="nl-record">' + escape(item.title) + (item.active ? ' <button class="btn" data-remove="' + item.id + '">Unpublish</button>' : ' · Unpublished') + '</div>').join('') || '<p>No listings yet.</p>') +
    (user.admin ? '<h2>Open reports</h2>' + (activity.reports.map(item => '<div class="nl-record"><strong>' + escape(item.title) + '</strong><p>' + escape(item.reason) + '</p><button class="btn" data-moderate="' + item.id + '" data-status="removed">Remove listing</button> <button class="btn" data-moderate="' + item.id + '" data-status="dismissed">Dismiss</button></div>').join('') || '<p>No open reports.</p>') : '') :
    '<button class="btn primary" data-signin>Sign in</button>';
  $('.threads').innerHTML = activity.threads.map(thread => '<button class="thread nl-thread' + (thread.id === threadId ? ' active' : '') + '" data-thread="' + thread.id + '"><b>' + escape(thread.title) + '</b><small>' + escape(thread.status) + ' · ' + escape(thread.owner === user?.id ? thread.requesterName : thread.ownerName) + '</small></button>').join('') || empty(user ? 'No requests yet.' : 'Sign in to see your requests.');
}
async function refresh() {
  [items,activity] = await Promise.all([
    api('/listings'), user ? api('/activity') : Promise.resolve({saved:[],threads:[],listings:[],reports:[]})
  ]);
  render();
}
function navigate(next, updateHash = true) {
  if (!user && next !== 'login') { next = 'login'; updateHash = true; }
  if (user && !user.profileComplete && !['profile','login'].includes(next)) { next = 'profile'; updateHash = true; }
  if (next === 'home') next = 'rentals';
  if (!views.includes(next)) next = 'landing';
  view = next;
  const route = next === 'landing' ? '/' : next === 'login' ? '/login' : next === 'profile' ? '/profile' : '/#' + next;
  if (updateHash && location.pathname + location.hash !== route) history.pushState(null,'',route);
  document.body.classList.toggle('nl-login',['login','profile'].includes(next));
  if (next === 'login') {
    if (!afterSignIn) signInReturn = 'landing';
    try { document.body.dataset.theme = localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme = 'light'; }
    renderAuth(false);
    requestAnimationFrame(() => auth.querySelector('[name="email"]').focus());
  }
  if (next === 'profile') {
    profileForm.elements.name.value = user?.name || '';
    profileForm.elements.email.value = user?.email || '';
    try { document.body.dataset.theme = localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme = 'light'; }
  }
  const portal = ['rentals','services','saved','messages','dashboard'].includes(next);
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active',section.id === 'view-' + (portal ? 'rentals' : next)));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view === next));
  $('.shell').classList.toggle('landing',next === 'landing');
  $('.shell').classList.toggle('borrowing',portal);
  updateBorrow();
  document.body.classList.toggle('nl-landing',next === 'landing');
  $('#crumb').textContent = next.toUpperCase();
  window.scrollTo(0,0);
  if (next === 'messages') return openThread(threadId);
}
async function openThread(id) {
  threadId = id;
  renderActivity();
  const thread = activity.threads.find(row => row.id === id);
  const chat = $('.chat-head');
  const messages = $('#messages');
  const form = $('#message-form');
  chat.replaceChildren();
  messages.replaceChildren();
  form.style.display = thread ? '' : 'none';
  if (!thread) {
    chat.textContent = 'Choose a request';
    activeMessages = [];
    updateBorrow();
    return;
  }
  chat.textContent = thread.title + ' · ' + thread.status;
  if (thread.start_date) {
    const summary = document.createElement('p');
    summary.className = 'nl-description';
    const dates = thread.kind === 'gear' ? thread.start_date + ' to ' + thread.end_date : thread.start_date;
    summary.textContent = dates + (thread.details ? ' · ' + thread.details : '');
    chat.append(summary);
  }
  if (thread.agreed_price != null) {
    const price = document.createElement('p');
    price.textContent = 'Agreed rate: ₹' + Number(thread.agreed_price).toLocaleString('en-IN') + (thread.kind === 'gear' ? ' per day' : ' per job');
    chat.append(price);
  }
  const timeline = document.createElement('ol');
  for (const [label, time] of [['Accepted',thread.accepted_at],['Pickup recorded',thread.pickup_at],['Return marked',thread.return_at],['Completed',thread.completed_at]]) {
    if (!time) continue;
    const entry = document.createElement('li');
    entry.textContent = label + ' · ' + new Date(time).toLocaleString();
    timeline.append(entry);
  }
  if (timeline.childElementCount) chat.append(timeline);
  const owner = thread.owner === user.id;
  if (thread.payment_status) chat.append(' · Demo payment ' + thread.payment_status);
  if (!owner && thread.status === 'accepted') {
    const pay = document.createElement('button');
    pay.className = 'btn primary';
    pay.textContent = thread.payment_status === 'succeeded' ? 'View demo receipt' : 'Demo checkout';
    pay.onclick = () => perform(async () => {
      const checkout = await api('/requests/' + id + '/checkout');
      const panel = document.createElement('dialog');
      panel.className = 'nl-dialog';
      const heading = document.createElement('h2');
      heading.textContent = 'Demo checkout';
      const summary = document.createElement('p');
      summary.textContent = 'Simulated payment. No money is collected. Total ₹' + (checkout.amount / 100).toLocaleString('en-IN') + ' for ' + checkout.days + (thread.kind === 'gear' ? ' calendar day(s).' : ' job.');
      panel.append(heading,summary);
      for (const outcome of checkout.status === 'succeeded' ? [] : ['succeeded','failed']) {
        const action = document.createElement('button');
        action.className = 'btn';
        action.textContent = outcome === 'succeeded' ? 'Simulate success' : 'Simulate failure';
        action.onclick = () => perform(async () => {
          panel.querySelectorAll('button').forEach(button => button.disabled = true);
          try {
            await api('/requests/' + id + '/checkout','POST',{outcome});
            panel.close();
            await refresh();
            await openThread(id);
            toast(outcome === 'succeeded' ? 'Demo payment recorded.' : 'Demo payment failed. You can retry.');
          } finally { panel.querySelectorAll('button').forEach(button => button.disabled = false); }
        });
        panel.append(action);
      }
      const close = document.createElement('button');
      close.className = 'btn';
      close.textContent = 'Close';
      close.onclick = () => panel.close();
      panel.append(close);
      panel.addEventListener('close',() => panel.remove());
      document.body.append(panel);
      panel.showModal();
    });
    chat.append(' ',pay);
  }
  const transitions = {
    pending: owner ? ['accepted','declined'] : ['cancelled'],
    accepted: owner ? [thread.kind === 'gear' ? 'active' : 'completion_proposed','cancelled'] : ['cancelled'],
    active: owner ? [] : ['returned'],
    returned: owner ? ['completed'] : [],
    completion_proposed: owner ? [] : ['completed']
  };
  const states = transitions[thread.status] || [];
  const labels = {accepted:'Accept',declined:'Decline',active:'Record pickup',returned:'Mark returned',
    completion_proposed:'Propose completion',completed:thread.kind === 'gear' ? 'Confirm receipt' : 'Confirm completion',cancelled:'Cancel request'};
  if (thread.score) chat.append(' · Rating ' + thread.score + '/5');
  if (!owner && thread.status === 'completed' && !thread.score) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = 'Leave a review';
    button.onclick = () => show(review);
    chat.append(' ',button);
  }
  for (const status of states) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = labels[status];
    button.dataset.transition = status;
    chat.append(' ',button);
  }
  const rows = await api('/requests/' + id + '/messages');
  if (threadId !== id || view !== 'messages') return;
  activeMessages = rows;
  updateBorrow();
  messages.replaceChildren(...rows.map(message => {
    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (message.sender === user.id ? ' me' : '');
    bubble.textContent = message.body;
    return bubble;
  }));
  messages.scrollTop = messages.scrollHeight;
}
async function perform(action) {
  try { await action(); } catch (error) { toast(error.message); }
}
document.addEventListener('click', event => perform(async () => {
  const button = event.target.closest('button,[data-view]');
  if (!button) return;
  const data = button.dataset;
  if (button.matches('#open-listing,#open-listing-2,#open-listing-3,#post-service')) return openListing(button.id === 'post-service' ? 'help' : 'gear');
  if (data.signin !== undefined) return requireUser(() => navigate('dashboard'));
  if (data.go || data.view) {
    const next = data.go || data.view;
    if (['saved','messages'].includes(next) && !user) return requireUser(() => navigate(next));
    if (query && ['rentals','services','home'].includes(next)) { query = ''; render(); }
    if (next === 'messages' && user) await refresh();
    return navigate(next);
  }
  if (data.filter) { filters[view] = data.filter; return render(); }
  if (data.save) return requireUser(async () => {
    await api('/saved/' + data.save,activity.saved.includes(Number(data.save)) ? 'DELETE' : 'PUT');
    await refresh();
  });
  if (data.request) return requireUser(async () => {
    await refresh();
    const id = Number(data.request);
    const existing = activity.threads.find(thread => thread.listing === id && thread.requester === user.id);
    if (existing) {
      threadId = existing.id;
      return navigate('messages');
    }
    const item = items.find(item => item.id === id);
    if (item) openBooking(item);
    else toast('Listing unavailable.');
  });
  if (data.report) return requireUser(() => { reportedId = data.report; show(report); });
  if (data.thread) return openThread(Number(data.thread));
  if (data.transition) {
    await api('/requests/' + threadId,'PATCH',{status:data.transition});
    await refresh();
    return openThread(threadId);
  }
  if (data.moderate) {
    await api('/reports/' + data.moderate,'PATCH',{status:data.status});
    return refresh();
  }
  if (data.remove && confirm('Unpublish this listing?')) {
    await api('/listings/' + data.remove,'DELETE');
    return refresh();
  }
  if (data.logout !== undefined) {
    await api('/logout','POST');
    user = null;
    threadId = null;
    activeMessages = [];
    items = [];
    deactivateProtectedFrames();
    navigate('login');
  }
}));
function search(value) {
  query = value.trim().toLowerCase();
  render();
}
$('#search-btn').onclick = () => search($('#global-search').value);
$('#global-search').onkeydown = event => { if (event.key === 'Enter') $('#search-btn').click(); };
for (const name of ['home','services']) {
  const form = document.createElement('form');
  form.className = 'nl-controls';
  form.setAttribute('role','search');
  form.innerHTML = '<input type="search" aria-label="Search by neighbourhood or listing" placeholder="Search by neighbourhood or listing"><button class="btn">Search</button>';
  form.onsubmit = event => { event.preventDefault(); search(form.querySelector('input').value); };
  const controls = document.createElement('div');
  controls.className = 'nl-controls';
  controls.innerHTML = '<button type="button" class="btn" data-nearby>Use my location</button>' +
    '<label>Within <select aria-label="Distance"><option value="5">5 km</option><option value="10" selected>10 km</option><option value="25">25 km</option></select></label>' +
    '<button type="button" class="btn" data-clear>Show all</button><span class="nearby-status" role="status"></span>';
  controls.querySelector('[data-nearby]').onclick = () => perform(async () => {
    visitorLocation = await locate();
    render();
  });
  controls.querySelector('select').onchange = event => {
    radius = Number(event.target.value);
    document.querySelectorAll('select[aria-label="Distance"]').forEach(select => select.value = String(radius));
    render();
  };
  controls.querySelector('[data-clear]').onclick = () => { visitorLocation = null; render(); };
  form.append(controls);
  $('#view-' + name + (name === 'home' ? ' .hero' : ' .page-title')).after(form);
}
$('#message-form').onsubmit = event => {
  event.preventDefault();
  const input = $('#message-input');
  const id = threadId;
  if (!input.value.trim() || !id) return;
  const button = event.target.querySelector('button');
  button.disabled = true;
  perform(async () => {
    try {
      await api('/requests/' + id + '/messages','POST',{message:input.value});
      input.value = '';
      if (threadId === id) await openThread(id);
    } finally { button.disabled = false; }
  });
};
function currentRoute() { return location.pathname === '/login' ? 'login' : location.pathname === '/profile' ? 'profile' : location.hash.slice(1) || 'landing'; }
window.addEventListener('popstate',() => perform(() => navigate(currentRoute(),Boolean(!user))));
perform(async () => {
  const requested = currentRoute();
  try { user = await api('/session'); } catch { user = null; }
  try {
    if (!user) return navigate('login');
    if (!user.profileComplete) return navigate('profile');
    activateProtectedFrames();
    await navigate(requested === 'login' ? 'landing' : requested,requested === 'login');
    await refresh();
    if (view === 'messages') await openThread(threadId);
  } finally { document.body.classList.remove('auth-loading'); }
});
