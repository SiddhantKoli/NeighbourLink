const $ = selector => document.querySelector(selector);
const empty = text => '<div class="empty">' + text + '</div>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const categories = { gear: ['Tools','Tech & Camera','Outdoors'], help: ['Home repair','Creative','Lessons'] };
const groups = { Tools:'tools', 'Tech & Camera':'tech', Outdoors:'outdoors', 'Home repair':'home', Creative:'creative', Lessons:'lessons' };
const filters = { home:'all', rentals:'all', services:'all' };
const views = ['landing','home','rentals','services','saved','messages','dashboard','login','profile','verify','reset'];
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
  '<p role="alert" class="nl-error"></p><button class="btn primary auth-submit" type="submit">Sign in</button><button type="button" class="auth-back" id="forgot-password">Forgot password?</button>' +
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
const paymentAccountDialog=dialog('payment-account-dialog','Connect a payout account',
  '<p>Enter your activated Razorpay Route linked account ID. This is required before renters can pay.</p><label class="nl-field">Linked account ID<input name="accountId" required maxlength="40" placeholder="acc_…"></label>');
submit(paymentAccountDialog,async form=>{
  await api('/payment-account','PUT',{accountId:form.get('accountId')});
  paymentAccountDialog.close();
  await refresh();
  if (threadId) await openThread(threadId);
  toast('Payout account connected.');
});
const claimDialog=dialog('claim-dialog','Report an item issue',
  '<label class="nl-field">What went wrong?<textarea name="reason" required maxlength="1000" rows="4"></textarea></label>');
submit(claimDialog,async form=>{
  await api('/requests/'+threadId+'/claim','POST',{reason:form.get('reason')});
  claimDialog.close();await refresh();await openThread(threadId);toast('Claim submitted for review.');
});
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
const bookingQuote=document.createElement('p');bookingQuote.className='nl-booking-quote';bookingQuote.setAttribute('aria-live','polite');
booking.querySelector('form .nl-controls').before(bookingQuote);
async function updateBookingQuote() {
  const form=booking.querySelector('form');
  if (!requestedListing||!form.elements.startDate.value||!form.elements.endDate.value) return;
  try { const quote=await api('/listings/'+requestedListing+'/quote?startDate='+encodeURIComponent(form.elements.startDate.value)+'&endDate='+encodeURIComponent(form.elements.endDate.value));bookingQuote.textContent='Estimated rental ₹'+(quote.rentMinor/100).toLocaleString('en-IN')+' + refundable deposit ₹'+(quote.depositMinor/100).toLocaleString('en-IN')+' · '+quote.days+' day(s).'; }
  catch(error) { bookingQuote.textContent=error.message; }
}
function openBooking(item) {
  const form = booking.querySelector('form');
  form.reset();
  requestedListing = item.id;
  const gear = item.kind === 'gear';
  bookingQuote.textContent='Deposit adjusts to item value, account trust and rental duration.';
  $('#booking-dialog-title').textContent = gear ? 'Request gear rental' : 'Request local help';
  $('#booking-date-label').textContent = gear ? 'Pickup date' : 'Preferred appointment date';
  $('#booking-details-label').textContent = gear ? 'Pickup notes (optional)' : 'What do you need help with?';
  form.elements.startDate.min = new Date().toISOString().slice(0,10);
  form.elements.endDate.parentElement.style.display = gear ? '' : 'none';
  form.elements.endDate.required = gear;
  form.elements.details.required = !gear;
  form.elements.startDate.onchange = () => { form.elements.endDate.min = form.elements.startDate.value;updateBookingQuote(); };
  form.elements.endDate.onchange=updateBookingQuote;
  form.elements.endDate.min = form.elements.startDate.min;
  booking.querySelector('.primary').textContent = 'Send request';
  show(booking);
}
submit(booking, async form => {
  const {id,depositMinor} = await api('/requests/' + requestedListing,'PUT',Object.fromEntries(form));
  booking.close();
  threadId = id;
  await refresh();
  await navigate('messages');
  if (depositMinor) toast('Request sent. Estimated refundable deposit ₹'+(depositMinor/100).toLocaleString('en-IN')+'.');
});

async function api(path, method = 'GET', body) {
  const response = await fetch('/api/v1' + path, {
    method, headers: body ? { 'Content-Type':'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (response.status === 403 && path !== '/profile') {
    navigate((data.error || '').toLowerCase().includes('confirm your email') ? 'verify' : 'profile');
    throw Error(data.error || 'Complete your account setup to continue.');
  }
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
async function uploadImage(file,purpose) {
  const response=await fetch('/api/v1/uploads',{method:'POST',headers:{'Content-Type':file.type,'X-Upload-Purpose':purpose},body:file});
  const data=await response.json();
  if (!response.ok) throw Error(data.error || 'Photo upload failed.');
  return data.uploadId;
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
    $('#forgot-password').hidden = signup;
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
$('#forgot-password').onclick = () => {
  $('#reset-request-form').elements.email.value=auth.querySelector('[name="email"]').value;
  navigate('reset');
};
submit(auth, async form => {
  await api('/' + auth.dataset.mode, 'POST', Object.fromEntries(form));
  user = await api('/session');
  if (!user.emailVerified) {
    auth.querySelector('form').reset();
    await navigate('verify');
    return;
  }
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
const phoneOtpForm=document.createElement('form');
phoneOtpForm.id='phone-otp-form';
phoneOtpForm.className='phone-otp-form';
phoneOtpForm.hidden=true;
phoneOtpForm.innerHTML='<h2>Verify your phone.</h2><p id="phone-otp-help">Enter the one-time code sent to your phone. The code expires in 10 minutes.</p><label class="auth-field">Six-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><p class="nl-error" id="phone-otp-error" role="alert"></p><button class="btn primary auth-submit" type="submit">Verify phone</button><button class="btn" id="phone-otp-resend" type="button">Send a new code</button></form>';
profileForm.after(phoneOtpForm);
profileForm.addEventListener('submit',event => {
  event.preventDefault();
  const button = profileForm.querySelector('.auth-submit');
  button.disabled = true;
  $('#profile-error').textContent = '';
  perform(async () => {
    try {
      const file = profileForm.elements.photoFile.files[0];
      let photoUploadId;
      if (file) {
        if (file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPEG, PNG, or WebP face photo under 1 MB.');
        photoUploadId=await uploadImage(file,'profile');
      } else if (!user?.hasProfilePhoto) throw Error('Choose a JPEG, PNG, or WebP face photo under 1 MB.');
      await api('/profile','PUT',{name:profileForm.elements.name.value,email:profileForm.elements.email.value,phone:profileForm.elements.phone.value,photoUploadId});
      user = await api('/session');
      if (!user.phoneVerified) {
        const sent=await api('/phone-otp/send','POST',{});
        profileForm.hidden=true;
        phoneOtpForm.hidden=false;
        $('#phone-otp-help').textContent='Enter the one-time code sent to ' + user.phone + '. It expires in 10 minutes.' + (sent.devCode ? ' Local development code: ' + sent.devCode : '');
        phoneOtpForm.elements.code.focus();
        return;
      }
      activateProtectedFrames();
      await refresh();
      await navigate('landing');
    } catch(error) { $('#profile-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
});
phoneOtpForm.addEventListener('submit',event=>{
  event.preventDefault();
  const button=phoneOtpForm.querySelector('.auth-submit');
  button.disabled=true;
  $('#phone-otp-error').textContent='';
  perform(async()=>{
    try {
      await api('/phone-otp/verify','POST',{code:phoneOtpForm.elements.code.value});
      user=await api('/session');
      if (!user.profileComplete) throw Error('Your profile is still incomplete.');
      activateProtectedFrames();
      await refresh();
      await navigate('landing');
    } catch(error) { $('#phone-otp-error').textContent=error.message; }
    finally { button.disabled=false; }
  });
});
$('#phone-otp-resend').onclick=()=>perform(async()=>{
  $('#phone-otp-error').textContent='';
  try {
    const sent=await api('/phone-otp/send','POST',{});
    $('#phone-otp-help').textContent='A new code was sent to ' + user.phone + '. It expires in 10 minutes.' + (sent.devCode ? ' Local development code: ' + sent.devCode : '');
  } catch(error) { $('#phone-otp-error').textContent=error.message; }
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
for (const id of ['verify-theme','reset-theme']) {
  $('#' + id).onclick = () => {
    const next=document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme=next;
    try { localStorage.setItem('nl-theme',next); } catch {}
  };
}
const verifyForm=$('#verify-form');
verifyForm.addEventListener('submit',event => {
  event.preventDefault();
  $('#verify-error').textContent='';
  perform(async () => {
    try {
      await api('/verify-email','POST',{token:verifyForm.elements.token.value});
      user=await api('/session');
      if (!user) { await navigate('login'); toast('Email confirmed. Sign in to continue.'); return; }
      if (!user.profileComplete) await navigate('profile');
      else { await refresh(); await navigate('landing'); }
    } catch(error) { $('#verify-error').textContent=error.message; }
  });
});
$('#verify-resend').onclick=() => perform(async () => {
  await api('/email-verification/resend','POST',{});
  $('#verify-status').textContent='If the address still needs confirmation, a new link is on its way.';
});
$('#reset-request-form').addEventListener('submit',event => {
  event.preventDefault();
  const form=event.currentTarget;
  $('#reset-request-error').textContent='';
  perform(async () => {
    try {
      await api('/password-reset','POST',{email:form.elements.email.value});
      $('#reset-status').textContent='If that address belongs to a verified account, a reset link is on its way.';
    } catch(error) { $('#reset-request-error').textContent=error.message; }
  });
});
$('#reset-complete-form').addEventListener('submit',event => {
  event.preventDefault();
  const form=event.currentTarget;
  $('#reset-complete-error').textContent='';
  perform(async () => {
    try {
      await api('/password-reset/complete','POST',{token:form.elements.token.value,password:form.elements.password.value});
      user=null;
      $('#reset-status').textContent='Your password has been changed. Sign in with the new password.';
      form.hidden=true;
    } catch(error) { $('#reset-complete-error').textContent=error.message; }
  });
});
$('#reset-back').onclick=() => navigate('login');
accountButton.onclick = () => perform(() => user ? navigate('dashboard') : requireUser(() => navigate('dashboard')));

function changeCategories() {
  const form = listing.querySelector('form');
  form.elements.category.replaceChildren(...categories[form.elements.kind.value].map(value => new Option(value)));
  const valueField=$('#item-value-field');
  valueField.hidden=form.elements.kind.value!=='gear';
  valueField.querySelector('input').required=form.elements.kind.value==='gear';
  $('#condition-field').hidden=form.elements.kind.value!=='gear';
  $('#condition-field').querySelector('textarea').required=form.elements.kind.value==='gear';
  $('#deposit-override-field').hidden=form.elements.kind.value!=='gear';
}
const itemValueField=document.createElement('div');
itemValueField.id='item-value-field';
itemValueField.className='field';
itemValueField.innerHTML='<label for="item-value-input">Approximate item value (₹)</label><input id="item-value-input" name="itemValue" type="number" min="1" max="1000000000" step="1" placeholder="15000"><small>Used to limit risk for new renter accounts.</small>';
listing.querySelector('[name="price"]').parentElement.after(itemValueField);
const conditionField=document.createElement('div');
conditionField.id='condition-field';
conditionField.className='field';
conditionField.innerHTML='<label for="condition-checklist">Condition checklist</label><textarea id="condition-checklist" name="conditionChecklistText" rows="3" maxlength="900" placeholder="Starts and runs normally&#10;No visible cracks&#10;Includes charger"></textarea><small>One condition per line. These points guide handover and return checks.</small>';
itemValueField.after(conditionField);
const depositOverrideField=document.createElement('div');
depositOverrideField.id='deposit-override-field';
depositOverrideField.className='field';
depositOverrideField.innerHTML='<label for="deposit-override">Preferred deposit (₹, optional)</label><input id="deposit-override" name="depositOverride" type="number" min="1" max="10000000" step="1" placeholder="Calculated automatically"><small>The final amount is risk-adjusted and limited by marketplace settings.</small>';
conditionField.after(depositOverrideField);
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
  if (body.kind==='gear') {
    body.itemValueMinor=Math.round(Number(body.itemValue)*100);
    body.conditionChecklist=String(body.conditionChecklistText||'').split('\n').map(value=>value.trim()).filter(Boolean);
    if (body.depositOverride) body.depositOverrideMinor=Math.round(Number(body.depositOverride)*100);
  }
  delete body.itemValue;delete body.conditionChecklistText;delete body.depositOverride;
  if (listingLocation) Object.assign(body,listingLocation);
  if (!file.size) throw Error('Choose a photo of the item or your work.');
  if (file.size > 1000000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPEG, PNG, or WebP photo under 1 MB.');
  body.photoUploadId=await uploadImage(file,'listing');
  delete body.photo;
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
  let conditions=[];try{conditions=JSON.parse(item.condition_checklist||'[]');if(!Array.isArray(conditions))conditions=[];}catch{}
  const conditionText=conditions.length?'<p class="nl-condition-list"><strong>Condition at listing</strong><br>'+conditions.map(escape).join('<br>')+'</p>':'';
  return '<article class="card"><div class="card-art art-' + (item.kind === 'gear' ? 'tool' : 'drill') + '">' +
    (item.hasPhoto ? '<img class="nl-photo" loading="lazy" src="/photos/' + item.id + '" alt="' + escape(item.title) + '">' : '<span class="nl-no-photo">No photo uploaded</span>') +
    '<span class="tag">' + escape(item.category) + '</span><button class="heart" aria-label="' + (saved ? 'Remove from saved' : 'Save listing') + '" aria-pressed="' + saved + '" data-save="' + item.id + '">' + (saved ? '♥' : '♡') + '</button></div>' +
    '<div class="card-body"><h3>' + escape(item.title) + '</h3><div class="meta">⌖ ' + escape(item.area) + '</div><p class="nl-description">' + escape(item.description) + '</p>'+conditionText+'<div class="owner">' + escape(item.name) + '</div></div>' +
    '<div class="card-foot"><div class="price"><strong>₹' + item.price.toLocaleString('en-IN') + '</strong> ' + (item.kind === 'gear' ? '/ DAY' : '/ JOB') + (item.kind==='gear'&&item.item_value_minor!=null?'<small class="item-value">Item value ₹'+Math.floor(item.item_value_minor/100).toLocaleString('en-IN')+'</small>':'') + '</div>' +
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
  if (user) loadKycCenter();
}
async function loadKycCenter() {
  const activityRoot=$('#activity');
  if (!activityRoot || !user) return;
  let center=$('#kyc-center');
  if (!center) {
    center=document.createElement('section');
    center.id='kyc-center';
    center.className='trust-center';
    activityRoot.append(center);
  }
  try {
    const status=await api('/kyc/status');
    if (!user || !center.isConnected) return;
    const label=status.status==='verified'?'Verified':status.status==='suspended'?'Suspended':status.submitted_at?'In review':'Not verified';
    center.innerHTML='<h2>Identity verification</h2><p>Status: <strong>'+escape(label)+'</strong></p><p>Optional for now. ID and selfie images are encrypted before storage and are visible only to an authorized reviewer. We do not collect or store an Aadhaar number.</p>'+
      (status.decision_reason?'<p>'+escape(status.decision_reason)+'</p>':'')+
      (status.status==='verified'?'<p>Your identity check is complete.</p>':status.status==='suspended'?'<p>Contact NeighbourLink support if you think this is a mistake.</p>':'<form id="kyc-submit-form"><label class="auth-field">Government ID image<input name="idFile" type="file" accept="image/jpeg,image/png,image/webp" required><small>Upload a valid government ID image. Do not upload an Aadhaar number unless you choose a provider that specifically requires it.</small></label><label class="auth-field">Face selfie<input name="selfieFile" type="file" accept="image/jpeg,image/png,image/webp" required></label><p class="nl-error" role="alert"></p><button class="btn primary" type="submit">'+(status.submitted_at?'Resubmit for review':'Submit for review')+'</button></form>');
    const form=$('#kyc-submit-form');
    if (form) form.onsubmit=event=>{
      event.preventDefault();
      const button=form.querySelector('button');
      const error=form.querySelector('.nl-error');
      button.disabled=true;
      error.textContent='';
      perform(async()=>{
        try {
          const idFile=form.elements.idFile.files[0],selfieFile=form.elements.selfieFile.files[0];
          for (const file of [idFile,selfieFile]) if (!file||file.size>1000000||!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose two JPEG, PNG, or WebP images under 1 MB each.');
          const idUploadId=await uploadImage(idFile,'kyc-id');
          const selfieUploadId=await uploadImage(selfieFile,'kyc-selfie');
          await api('/kyc/submit','POST',{idUploadId,selfieUploadId});
          await refresh();
          toast('Identity documents sent for review.');
        } catch(failure) { error.textContent=failure.message; }
        finally { button.disabled=false; }
      });
    };
    if (user.admin) {
      const queue=await api('/admin/kyc');
      if (!user || !center.isConnected) return;
      center.innerHTML+='<h3>Identity review queue</h3>'+(queue.map(row=>'<article class="kyc-review"><strong>'+escape(row.name)+' · '+escape(row.email)+'</strong><p>'+escape(row.status)+' · submitted '+escape(row.submitted_at||'not submitted')+'</p>'+(row.submitted_at?'<p><a target="_blank" rel="noopener" href="/api/v1/admin/kyc/'+row.user_id+'/documents/id">Open ID image</a> · <a target="_blank" rel="noopener" href="/api/v1/admin/kyc/'+row.user_id+'/documents/selfie">Open selfie</a></p>':'')+'<label class="auth-field">Decision note<input data-kyc-reason="'+row.user_id+'" maxlength="500"></label><button class="btn" data-kyc-status="verified" data-user-id="'+row.user_id+'">Verify</button> <button class="btn" data-kyc-status="suspended" data-user-id="'+row.user_id+'">Suspend</button></article>').join('')||'<p>No identity submissions.</p>');
    }
  } catch(error) { center.textContent='Identity verification is temporarily unavailable.'; }
}
async function refresh() {
  [items,activity] = await Promise.all([
    api('/listings'), user ? api('/activity') : Promise.resolve({saved:[],threads:[],listings:[],reports:[]})
  ]);
  render();
}
function navigate(next, updateHash = true) {
  if (!user && !['login','verify','reset'].includes(next)) { next = 'login'; updateHash = true; }
  if (user && !user.emailVerified && !['verify','login','reset'].includes(next)) { next = 'verify'; updateHash = true; }
  if (user && user.emailVerified && !user.profileComplete && !['profile','login','verify','reset'].includes(next)) { next = 'profile'; updateHash = true; }
  if (next === 'home') next = 'rentals';
  if (!views.includes(next)) next = 'landing';
  view = next;
  const currentToken=new URLSearchParams(location.search).get('token');
  const route = next === 'landing' ? '/' : next === 'login' ? '/login' : next === 'profile' ? '/profile' : next === 'verify' ? '/verify-email' + (currentToken ? '?token=' + encodeURIComponent(currentToken) : '') : next === 'reset' ? '/reset-password' + (currentToken ? '?token=' + encodeURIComponent(currentToken) : '') : '/#' + next;
  if (updateHash && location.pathname + location.hash !== route) history.pushState(null,'',route);
  document.body.classList.toggle('nl-login',['login','profile','verify','reset'].includes(next));
  if (next === 'login') {
    if (!afterSignIn) signInReturn = 'landing';
    try { document.body.dataset.theme = localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme = 'light'; }
    renderAuth(false);
    requestAnimationFrame(() => auth.querySelector('[name="email"]').focus());
  }
  if (next === 'profile') {
    profileForm.elements.name.value = user?.name || '';
    profileForm.elements.email.value = user?.email || '';
    profileForm.elements.phone.value = user?.phone || '';
    profileForm.elements.photoFile.required = !user?.hasProfilePhoto;
    profileForm.hidden=false;
    phoneOtpForm.hidden=true;
    $('#view-profile .profile-setup-card > p').textContent='Add a clear face photo, your reachable phone number, and confirm it with a one-time SMS code.';
    $('#view-profile .profile-privacy').textContent='Your face photo and phone number are private to your account and are not displayed on listings or shared with members in this pilot.';
    const notes=document.querySelectorAll('#view-profile .profile-id-note');
    notes[0].textContent='Optional identity review is available from My account. NeighbourLink stores encrypted ID and selfie images for manual review; no Aadhaar number is collected here.';
    notes[1].textContent='Account recovery uses verified email links. Security questions are not used because answers can be guessed.';
    try { document.body.dataset.theme = localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme = 'light'; }
  }
  if (next === 'verify') {
    verifyForm.elements.token.value=currentToken || '';
    $('#verify-copy').textContent=user?.email ? 'Open the confirmation link we sent to ' + user.email + '. Email must be confirmed before you can continue.' : 'Open the confirmation link in your email, then sign in to continue.';
    $('#verify-resend').hidden=!user;
    try { document.body.dataset.theme=localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme='light'; }
  }
  if (next === 'reset') {
    $('#reset-request-form').hidden=!!currentToken;
    $('#reset-complete-form').hidden=!currentToken;
    $('#reset-complete-form').elements.token.value=currentToken || '';
    try { document.body.dataset.theme=localStorage.getItem('nl-theme') || 'light'; } catch { document.body.dataset.theme='light'; }
  }
  const portal = ['rentals','services','saved','messages'].includes(next);
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
  if (thread.kind==='gear'&&['paid','active','claim_window','disputed'].includes(thread.status)) {
    let conditions=[];try{conditions=JSON.parse(thread.condition_checklist||'[]');if(!Array.isArray(conditions))conditions=[];}catch{}
    if (conditions.length) {const note=document.createElement('section'),title=document.createElement('strong'),list=document.createElement('ul');title.textContent='Compare against the listing condition';for(const condition of conditions){const row=document.createElement('li');row.textContent=condition;list.append(row);}note.append(title,list);chat.append(note);}
  }
  if (thread.status==='claim_window'&&thread.claim_deadline) {const windowText=document.createElement('p');windowText.textContent='Owner claim window closes '+new Date(thread.claim_deadline).toLocaleString()+'.';chat.append(windowText);}
  if (thread.payment_status) chat.append(' · Payment ' + thread.payment_status);
  if (owner&&thread.kind==='gear'&&['requested','accepted'].includes(thread.status)) {
    const payout=await api('/payment-account');
    if (!payout.account_id) {
      const connect=document.createElement('button');connect.className='btn';connect.textContent='Connect Razorpay Route account';connect.onclick=()=>show(paymentAccountDialog);chat.append(' ',connect);
    }
  }
  if (!owner&&thread.kind==='gear'&&thread.status==='accepted') {
    const pay=document.createElement('button');pay.className='btn primary';pay.textContent='Pay securely';
    pay.onclick=()=>perform(async()=>{
      const quote=await api('/requests/'+id+'/checkout');
      if (quote.mode==='unavailable') throw Error('Payments are not enabled yet. Razorpay TEST credentials and Route approval are required.');
      const summary=document.createElement('dialog');summary.className='nl-dialog';
      summary.innerHTML='<h2>Protected rental payment</h2><p>Rental price: ₹'+(quote.rentAmount/100).toLocaleString('en-IN')+'</p><p>Refundable deposit: ₹'+(quote.depositAmount/100).toLocaleString('en-IN')+'</p><p>Checkout total: ₹'+(quote.amount/100).toLocaleString('en-IN')+'</p><p>Razorpay TEST MODE: no live payment is collected.</p><p>Razorpay processes payment and seller settlement. NeighbourLink does not hold customer money.</p><p role="alert" class="nl-error"></p><div class="nl-controls"><button class="btn primary" type="button" data-pay>Continue to Razorpay TEST</button><button class="btn" type="button" data-close>Cancel</button></div>';
      document.body.append(summary);summary.showModal();
      summary.querySelector('[data-close]').onclick=()=>summary.close();
      summary.addEventListener('close',()=>summary.remove());
      summary.querySelector('[data-pay]').onclick=()=>perform(async()=>{
        const action=summary.querySelector('[data-pay]');action.disabled=true;
        try {
          const order=await api('/requests/'+id+'/checkout','POST',{});
          if (!window.Razorpay) {
            await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.onload=resolve;script.onerror=()=>reject(Error('Razorpay Checkout could not load.'));document.head.append(script);});
          }
          const checkout=new window.Razorpay({key:order.keyId,amount:order.amount,currency:order.currency,name:order.name,description:'Protected NeighbourLink rental',order_id:order.orderId,
            handler:async response=>{try{await api('/requests/'+id+'/checkout/verify','POST',response);summary.close();await refresh();await openThread(id);toast('Payment confirmed. Upload handover photos with the owner.');}catch(error){summary.querySelector('.nl-error').textContent=error.message;}},
            modal:{ondismiss:()=>{action.disabled=false;}}});
          checkout.open();
        } catch(error) { summary.querySelector('.nl-error').textContent=error.message;action.disabled=false; }
      });
    });
    chat.append(' ',pay);
  }
  if (thread.kind==='gear'&&['paid','active'].includes(thread.status)) {
    const phase=thread.status==='paid'?'handover':'return';
    const evidence=await api('/requests/'+id+'/evidence');
    const mine=evidence.some(item=>item.phase===phase&&item.uploader_user_id===user.id);
    const sides=evidence.filter(item=>item.phase===phase).length;
    const progress=document.createElement('p');progress.textContent=(phase==='handover'?'Handover':'Return')+' photos: '+sides+'/2 sides uploaded.';chat.append(progress);
    if (!mine) {
      const field=document.createElement('label');field.className='btn';field.textContent='Choose '+(phase==='handover'?'handover':'return')+' photo';
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('capture','environment');input.setAttribute('aria-label','Choose timestamped '+phase+' evidence photo');field.append(input);
      const upload=document.createElement('button');upload.className='btn primary';upload.textContent='Submit '+phase+' photo';
      upload.onclick=()=>perform(async()=>{const file=input.files[0];if(!file)throw Error('Choose a photo first.');const uploadId=await uploadImage(file,'booking-'+phase);const result=await api('/requests/'+id+'/evidence','POST',{phase,uploadId});await refresh();await openThread(id);toast(result.lateFeeMinor?'Late fee ₹'+(result.lateFeeMinor/100).toLocaleString('en-IN')+' assessed from the refundable deposit.':sides===1?'Both sides confirmed. Booking status updated.':'Photo saved with its upload time.');});
      chat.append(field,upload);
    }
  }
  if (thread.kind==='gear'&&['paid','active','claim_window','disputed','completed','resolved'].includes(thread.status)) {
    const bookingEvidence=await api('/requests/'+id+'/evidence');
    if (bookingEvidence.length) {
      const list=document.createElement('ul');
      for (const entry of bookingEvidence) {
        const row=document.createElement('li'),link=document.createElement('a');
        link.href='/api/v1/requests/'+id+'/evidence/'+entry.id;link.target='_blank';link.rel='noopener';
        link.textContent=entry.phase+' photo · '+entry.name+' · '+new Date(entry.uploaded_at).toLocaleString();row.append(link);list.append(row);
      }
      chat.append(list);
    }
    const contact=document.createElement('button');contact.className='btn';contact.textContent='View booking contact';contact.onclick=()=>perform(async()=>{const details=await api('/requests/'+id+'/contact');toast(details.name+' · '+details.phone);});chat.append(' ',contact);
  }
  if (thread.kind==='gear'&&owner&&thread.status==='claim_window') {
    const claim=document.createElement('button');claim.className='btn primary';claim.textContent='Raise an item claim';claim.onclick=()=>show(claimDialog);chat.append(' ',claim);
  }
  const transitions = {
    pending: owner ? ['accepted','declined'] : ['cancelled'],
    requested: owner ? ['accepted','declined'] : ['cancelled'],
    accepted: owner ? (thread.kind==='gear'?[]:['completion_proposed','cancelled']) : ['cancelled'],
    active: thread.kind==='gear'?[]:owner?[]:['returned'],
    returned: thread.kind==='gear'?[]:owner?['completed']:[],
    paid: ['cancelled'],claim_window:[],disputed:[],
    completion_proposed: owner ? [] : ['completed']
  };
  const states = transitions[thread.status] || [];
  const labels = {accepted:'Accept',declined:'Decline',active:'Record pickup',returned:'Mark returned',
    completion_proposed:'Propose completion',completed:thread.kind === 'gear' ? 'Confirm receipt' : 'Confirm completion',cancelled:'Cancel request'};
  if (thread.score) chat.append(' · Rating ' + thread.score + '/5');
  if (thread.kind==='gear'&&thread.otherScore) chat.append(' · Other side rated '+thread.otherScore+'/5');
  if ((!owner||thread.kind==='gear')&&['completed','resolved'].includes(thread.status)&&!thread.score) {
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
  if (data.kycStatus && data.userId) {
    const reason=$('[data-kyc-reason="'+data.userId+'"]').value;
    await api('/admin/kyc/'+data.userId+'/status','PATCH',{status:data.kycStatus,reason});
    await refresh();
    return toast('Identity status updated.');
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
function currentRoute() { return location.pathname === '/login' ? 'login' : location.pathname === '/profile' ? 'profile' : location.pathname === '/verify-email' ? 'verify' : location.pathname === '/reset-password' ? 'reset' : location.hash.slice(1) || 'landing'; }
window.addEventListener('popstate',() => perform(() => navigate(currentRoute(),Boolean(!user))));
perform(async () => {
  const requested = currentRoute();
  try { user = await api('/session'); } catch { user = null; }
  try {
    if (!user) return navigate(['reset','verify'].includes(requested) ? requested : 'login');
    if (!user.emailVerified) return navigate('verify',false);
    if (!user.profileComplete) return navigate('profile',false);
    activateProtectedFrames();
    await navigate(requested === 'login' ? 'landing' : requested,requested === 'login');
    await refresh();
    if (view === 'messages') await openThread(threadId);
  } finally { document.body.classList.remove('auth-loading'); }
});
