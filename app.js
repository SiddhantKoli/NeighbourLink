const $ = selector => document.querySelector(selector);
const empty = text => '<div class="empty">' + text + '</div>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
function safeRazorpayUrl(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&['rzp.io','checkout.razorpay.com'].includes(url.hostname)?url.href:'';} catch {return '';}
}
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
const portalFilters={gear:null,help:null};
const portalResults={gear:null,help:null};
function portalSearchUrl(kind,filters) {
  if (!filters) return '/listings';
  const params=new URLSearchParams({kind,sort:filters.sort||'newest'});
  for (const key of ['category','minPrice','maxPrice','startDate','endDate','minRating']) if (filters[key]) params.set(key,filters[key]);
  const currentRadius=Number(filters.radius||radius);
  if (visitorLocation) {params.set('latitude',visitorLocation.latitude);params.set('longitude',visitorLocation.longitude);params.set('radius',String(currentRadius));}
  return '/listings?'+params.toString();
}
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
  '<label class="nl-field">What went wrong?<textarea name="reason" required maxlength="1000" rows="4"></textarea></label><label class="nl-field">Supporting photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required><span>Use a clear JPEG, PNG or WebP photo under 1 MB.</span></label>');
submit(claimDialog,async form=>{
  const photo=form.elements.photo.files[0];
  if (!photo||photo.size>1000000||!['image/jpeg','image/png','image/webp'].includes(photo.type)) throw Error('Choose one JPEG, PNG or WebP photo under 1 MB.');
  const uploadId=await uploadImage(photo,'booking-claim');
  await api('/requests/'+threadId+'/claim','POST',{reason:form.get('reason'),uploadId});
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
async function acceptShopInviteFromLink() {
  const url=new URL(location.href),inviteId=url.searchParams.get('shopInvite');if(!inviteId)return;
  try {await api('/shop-invitations/'+encodeURIComponent(inviteId)+'/accept','POST',{});toast('Shop invitation accepted.');}
  catch(error) {toast(error.message);}
  url.searchParams.delete('shopInvite');history.replaceState(null,'',url.pathname+url.search+url.hash);
}
submit(auth, async form => {
  const authResult=await api('/' + auth.dataset.mode, 'POST', Object.fromEntries(form));
  user = await api('/session');
  if (!user.emailVerified) {
    auth.querySelector('form').reset();
    await navigate('verify');
    if(authResult.devEmailCode) $('#verify-status').textContent='Local development code: ' + authResult.devEmailCode;
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
  await acceptShopInviteFromLink();
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
        $('#phone-otp-help').textContent=sent.devCode ? 'Local phone verification code: ' + sent.devCode + '. This code is separate from your email code and expires in 10 minutes.' : 'Enter the one-time code sent to ' + user.phone + '. It expires in 10 minutes.';
        phoneOtpForm.elements.code.focus();
        return;
      }
      activateProtectedFrames();
      await refresh();
      await acceptShopInviteFromLink();
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
      await acceptShopInviteFromLink();
      await navigate('landing');
    } catch(error) { $('#phone-otp-error').textContent=error.message; }
    finally { button.disabled=false; }
  });
});
$('#phone-otp-resend').onclick=()=>perform(async()=>{
  $('#phone-otp-error').textContent='';
  try {
    const sent=await api('/phone-otp/send','POST',{});
    phoneOtpForm.elements.code.value='';
    $('#phone-otp-help').textContent=sent.devCode ? 'New local phone verification code: ' + sent.devCode + '. It expires in 10 minutes.' : 'A new code was sent to ' + user.phone + '. It expires in 10 minutes.';
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
      await api('/verify-email','POST',{token:verifyForm.elements.token.value,code:verifyForm.elements.code.value});
      user=await api('/session');
      if (!user) { await navigate('login'); toast('Email confirmed. Sign in to continue.'); return; }
      if (!user.profileComplete) await navigate('profile');
      else { await refresh(); await navigate('landing'); }
    } catch(error) { $('#verify-error').textContent=error.message; }
  });
});
$('#verify-resend').onclick=() => perform(async () => {
  const result=await api('/email-verification/resend','POST',{});
  verifyForm.elements.code.value='';
  $('#verify-status').textContent=result.devEmailCode ? 'Local development code: ' + result.devEmailCode : 'If the address still needs confirmation, a new six-digit code is on its way.';
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
const inventoryField=document.createElement('div');
inventoryField.className='field';
inventoryField.innerHTML='<label for="listing-quantity">Available units</label><input id="listing-quantity" name="quantity" type="number" min="1" max="20" value="1" required><small>Personal listings have one unit. Shop plan limits apply to multi-unit stock.</small>';
depositOverrideField.after(inventoryField);
const shopField=document.createElement('div');
shopField.className='field';
shopField.innerHTML='<label for="listing-shop">Shop account (optional)</label><select id="listing-shop" name="shopId"><option value="">Personal listing</option></select>';
inventoryField.after(shopField);
const listingStatusField=document.createElement('div');
listingStatusField.className='field';
listingStatusField.innerHTML='<label for="listing-status">Save as</label><select id="listing-status" name="status"><option value="published">Publish listing</option><option value="draft">Save draft</option></select>';
shopField.after(listingStatusField);
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
  return requireUser(async () => {
    const form = listing.querySelector('form');
    form.reset();
    form.elements.kind.value = kind;
    const shops=await api('/shops').catch(()=>[]),select=form.elements.shopId;
    select.replaceChildren(new Option('Personal listing',''),...shops.map(shop=>new Option(shop.name+' · '+shop.role,shop.id)));
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
  body.quantity=Number(body.quantity);if(!body.shopId)delete body.shopId;
  body.photoUploadId=await uploadImage(file,'listing');
  delete body.photo;
  await api('/listings','POST',body);
  listing.close();
  query = '';
  const target = body.kind === 'gear' ? 'rentals' : 'services';
  filters[target] = 'all';
  await refresh();
  navigate(target);
  toast(body.status==='draft'?'Listing saved as a draft.':'Listing published.');
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
    '<div class="card-foot"><div class="price"><strong>₹' + item.price.toLocaleString('en-IN') + '</strong> ' + (item.kind === 'gear' ? '/ DAY' : '/ JOB') + (Number(item.quantity_available)>1?'<small class="item-value">'+Number(item.quantity_available)+' units available</small>':'') + (item.kind==='gear'&&item.item_value_minor!=null?'<small class="item-value">Item value ₹'+Math.floor(item.item_value_minor/100).toLocaleString('en-IN')+'</small>':'') + '</div>' +
    (item.owner === user?.id ? '' : '<button data-request="' + item.id + '">REQUEST →</button>') +
    '</div><button class="btn" data-report="' + item.id + '">Report</button></article>';
}
function render() {
  const currentItems=view==='services'&&portalResults.help?portalResults.help:view==='rentals'&&portalResults.gear?portalResults.gear:items;
  const available = [...currentItems, ...examples.filter(example => !currentItems.some(item => item.kind === example.kind))];
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
  const gearItems=portalResults.gear||items;
  frame?.contentWindow?.postMessage({source:'neighbourlink-app',items:gearItems,filtered:Boolean(portalFilters.gear),activity,user,location:visitorLocation,area:visitorArea,view,threadId,messages:activeMessages,theme},location.origin);
}
$('.borrow-frame').addEventListener('load',updateBorrow);
window.addEventListener('message',event => {
  if (event.origin !== location.origin || event.source !== $('.borrow-frame').contentWindow || event.data?.source !== 'neighbourlink-borrow') return;
  const {action,id} = event.data;
  perform(async () => {
    if (action === 'ready') return updateBorrow();
    if (action === 'filters') {
      const kind=id==='services'?'help':'gear',incoming=event.data.filters||{};
      portalFilters[kind]={kind,...incoming};
      portalResults[kind]=await api(portalSearchUrl(kind,portalFilters[kind]));
      render();return;
    }
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
    (activity.listings.map(item => '<article class="seller-listing" data-calendar-listing="'+item.id+'"><div class="nl-controls"><strong>' + escape(item.title) + '</strong><span>'+escape(item.listing_status|| (item.active?'published':'draft'))+' · '+Number(item.quantity_available||1)+' unit(s)</span>' + (item.active ? '<button class="btn" data-remove="' + item.id + '">Unpublish</button>' : '<button class="btn primary" data-publish="'+item.id+'">Publish</button>') + '<button class="btn" data-duplicate="'+item.id+'">Duplicate as draft</button></div>'+(item.kind==='gear'?'<details><summary>Manage availability dates</summary><form class="availability-form"><label class="auth-field">Block from<input name="startDate" type="date" required></label><label class="auth-field">Through<input name="endDate" type="date" required></label><button type="button" class="btn primary" data-block-dates="'+item.id+'">Block these dates</button></form><div class="availability-list">Loading dates…</div></details>':'')+'</article>').join('') || '<p>No listings yet.</p>') +
    '<section class="seller-center" id="seller-center"><h2>Seller summary</h2><p>Loading earnings and release estimates…</p></section><section class="seller-center" id="shop-center"><h2>Shop accounts</h2><p>Loading business tools…</p></section>'+
    (user.admin?'<section class="seller-center" id="shop-review-queue"><h2>Business verification queue</h2><p>Loading submissions…</p></section>':'')+
    (user.admin ? '<h2>Open reports</h2>' + (activity.reports.map(item => '<div class="nl-record"><strong>' + escape(item.title) + '</strong><p>' + escape(item.reason) + '</p><button class="btn" data-moderate="' + item.id + '" data-status="removed">Remove listing</button> <button class="btn" data-moderate="' + item.id + '" data-status="dismissed">Dismiss</button></div>').join('') || '<p>No open reports.</p>') : '') :
    '<button class="btn primary" data-signin>Sign in</button>';
  $('.threads').innerHTML = activity.threads.map(thread => '<button class="thread nl-thread' + (thread.id === threadId ? ' active' : '') + '" data-thread="' + thread.id + '"><b>' + escape(thread.title) + '</b><small>' + escape(thread.status) + ' · ' + escape(thread.owner === user?.id ? thread.requesterName : thread.ownerName) + '</small></button>').join('') || empty(user ? 'No requests yet.' : 'Sign in to see your requests.');
  if (user) {
    const policyLinks=document.createElement('nav');policyLinks.className='account-policy-links';policyLinks.setAttribute('aria-label','Policies');policyLinks.innerHTML='<a href="/terms">Terms draft</a><a href="/privacy">Privacy draft</a><a href="/cancellation-refunds">Cancellation and refund draft</a><a href="/banned-items">Banned items draft</a>';$('#activity').append(policyLinks);
    loadSellerCenter();loadAvailability();loadKycCenter();loadShopCenter();if(user.admin)loadAdminShopQueue();
  }
}
async function loadSellerCenter() {
  const root=$('#seller-center');if(!root||!user)return;
  try {
    const data=await api('/seller/dashboard');if(!root.isConnected)return;
    const money=value=>'₹'+(Number(value||0)/100).toLocaleString('en-IN',{maximumFractionDigits:2});
    root.innerHTML='<h2>Seller summary</h2><div class="seller-metrics"><article><strong>'+data.listings.active+'</strong><span>Active listings</span></article><article><strong>'+data.bookings.completed+'</strong><span>Completed rentals</span></article><article><strong>'+money(data.releasedThroughProviderMinor)+'</strong><span>Released to Razorpay settlement</span></article><article><strong>'+money(data.heldWithProvider.rentalMinor)+'</strong><span>Rental amount currently held</span></article><article><strong>'+money(data.heldWithProvider.refundableDepositMinor)+'</strong><span>Refundable deposits currently held</span></article></div><h3>Estimated upcoming releases</h3>'+(data.upcoming.map(row=>'<div class="nl-record"><strong>'+escape(row.title)+'</strong><p>'+escape(row.status)+' · expected after return and claim window: '+escape(row.estimated_release_at?new Date(row.estimated_release_at).toLocaleString():'date not set')+'</p><p>Estimated rental release '+money(row.rental_release_minor)+' · refundable deposit '+money(row.refundable_deposit_minor)+' (not seller earnings)</p></div>').join('')||'<p>No provider-held rental transfers.</p>')+'<p>Release estimates are based on booking dates and claim settings. Razorpay controls bank settlement timing; these figures are not a bank payout promise.</p>';
  } catch(error) {if(root.isConnected)root.innerHTML='<h2>Seller summary</h2><p role="alert">Could not load seller information: '+escape(error.message)+'</p>';}
}
async function loadShopCenter() {
  const root=$('#shop-center');if(!root||!user)return;
  try {
    const [shopList,plans,pendingInvites]=await Promise.all([api('/shops'),api('/shops/plans'),api('/shop-invitations')]);
    const shops=await Promise.all(shopList.map(shop=>api('/shops/'+shop.id)));if(!root.isConnected)return;
    root.innerHTML='<h2>Shop accounts</h2><p>Run several listings with team access, stock counts and simple reports.</p>'+ (pendingInvites.length?'<div class="shop-invitation-inbox"><h3>Shop invitations</h3>'+pendingInvites.map(invite=>'<div class="nl-record"><strong>'+escape(invite.shop_name)+'</strong><p>'+escape(invite.inviter_name)+' invited you as '+escape(invite.role)+' · expires '+escape(invite.expires_at)+'</p><button class="btn primary" data-accept-shop-invite="'+escape(invite.id)+'">Accept invitation</button></div>').join('')+'</div>':'')+'<form id="shop-create-form" class="nl-controls"><label class="auth-field">Shop name<input name="name" maxlength="100" required></label><label class="auth-field">Business type<select name="businessType"><option value="sole_proprietor">Sole proprietor</option><option value="partnership">Partnership</option><option value="private_limited">Private limited</option><option value="cooperative">Cooperative</option><option value="other">Other</option></select></label><label class="auth-field">Registration reference (optional)<input name="registrationReference" maxlength="80"></label><button class="btn primary">Create shop</button></form>'+
      (shops.map(shop=>'<article class="shop-card"><div class="nl-controls"><h3>'+escape(shop.name)+'</h3><span>Business review: '+escape(shop.verification_status)+'</span><span>Plan: '+escape(shop.plan_key||'community')+' · '+escape(shop.subscription_status||'active')+'</span></div>'+
        '<details><summary>Business verification</summary><p>Upload a registration document for private, encrypted admin review. This is separate from personal identity verification.</p>'+(shop.role==='owner'?'<form class="shop-verification-form" data-shop="'+escape(shop.id)+'"><label class="auth-field">Business registration document<input name="document" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="btn primary">Submit for review</button></form>':'<p>Only the shop owner can submit verification documents.</p>')+'</details>'+
        '<details><summary>Team access · '+shop.members.length+' member(s)</summary>'+(shop.role==='owner'||shop.role==='manager'?'<form class="shop-member-form nl-controls" data-shop="'+escape(shop.id)+'"><label class="auth-field">Verified member email<input name="email" type="email" required></label><label class="auth-field">Role<select name="role">'+(shop.role==='owner'?'<option value="manager">Manager</option>':'')+'<option value="staff">Staff</option></select></label><button class="btn primary">Invite team member</button></form>':'')+'<ul>'+shop.members.map(member=>'<li>'+escape(member.name)+' · '+escape(member.email)+' · '+escape(member.role)+(shop.role==='owner'&&member.role!=='owner'?' <button class="btn" data-shop-remove="'+escape(shop.id)+'" data-member="'+member.user_id+'">Remove</button>':'')+'</li>').join('')+'</ul>'+(shop.pendingInvitations?.length?'<h4>Invitations awaiting acceptance</h4>'+shop.pendingInvitations.map(invite=>'<p>'+escape(invite.invitee_email)+' · '+escape(invite.role)+' · expires '+escape(invite.expires_at)+'</p>').join(''):'')+'</details>'+
        '<details><summary>Plan and reports</summary><p>'+plans.map(plan=>'<span class="shop-plan"><strong>'+escape(plan.name)+'</strong> · '+(Number(plan.price_minor)?'₹'+(Number(plan.price_minor)/100).toLocaleString('en-IN')+'/month':'Free')+' · '+plan.max_active_listings+' active listings · '+plan.max_quantity_per_listing+' unit(s) per listing</span>').join('<br>')+'</p>'+(shop.role==='owner'?'<form class="shop-plan-form" data-shop="'+escape(shop.id)+'"><label class="auth-field">Choose a plan<select name="planKey">'+plans.map(plan=>'<option value="'+escape(plan.plan_key)+'" '+(shop.plan_key===plan.plan_key?'selected':'')+'>'+escape(plan.name)+'</option>').join('')+'</select></label><button class="btn primary">Update plan</button></form>':'')+(shop.subscription?.status==='pending_auth'&&safeRazorpayUrl(shop.subscription.checkout_url)?'<p><a class="btn primary" rel="noopener noreferrer" target="_blank" href="'+escape(safeRazorpayUrl(shop.subscription.checkout_url))+'">Continue secure subscription checkout</a></p>':'')+'<button class="btn" data-shop-report="'+escape(shop.id)+'">View shop report</button><pre class="shop-report" data-report="'+escape(shop.id)+'" hidden></pre></details>'+
        '<div class="shop-inventory"><strong>Inventory</strong>'+((shop.inventory||[]).map(item=>'<p>'+escape(item.title)+' · '+escape(item.listing_status)+' · '+item.quantity_available+' unit(s)</p>').join('')||'<p>Use “Post a listing” and select this shop to add inventory.</p>')+'</div></article>').join('')||'<p>No shop yet. Create one to add team roles and multi-unit inventory.</p>');
    $('#shop-create-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;perform(async()=>{await api('/shops','POST',Object.fromEntries(new FormData(form)));await refresh();toast('Shop created.');});};
    root.querySelectorAll('.shop-verification-form').forEach(form=>form.onsubmit=event=>{event.preventDefault();perform(async()=>{const file=form.elements.document.files[0];if(!file||file.size>1000000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG, or WebP document under 1 MB.');const uploadId=await uploadImage(file,'business-doc');await api('/shops/'+form.dataset.shop+'/verification','POST',{uploadId});await refresh();toast('Business document sent for encrypted review.');});});
    root.querySelectorAll('.shop-member-form').forEach(form=>form.onsubmit=event=>{event.preventDefault();perform(async()=>{await api('/shops/'+form.dataset.shop+'/members','POST',Object.fromEntries(new FormData(form)));await refresh();toast('Invitation email sent. The role starts after they accept.');});});
    root.querySelectorAll('.shop-plan-form').forEach(form=>form.onsubmit=event=>{event.preventDefault();perform(async()=>{const result=await api('/shops/'+form.dataset.shop+'/subscription','POST',{planKey:form.elements.planKey.value});await refresh();toast(result.status==='pending_auth'?'Subscription checkout is ready; use the secure checkout link in this shop.':'Community plan selected.');});});
  } catch(error) {if(root.isConnected)root.innerHTML='<h2>Shop accounts</h2><p role="alert">'+escape(error.message)+'</p>';}
}
async function loadAdminShopQueue() {
  const root=$('#shop-review-queue');if(!root||!user?.admin)return;
  try {const shops=await api('/admin/shops');if(!root.isConnected)return;
    root.innerHTML='<h2>Business verification queue</h2>'+(shops.map(shop=>'<article class="nl-record"><h3>'+escape(shop.name)+'</h3><p>'+escape(shop.business_type)+' · '+escape(shop.owner_name)+' · '+escape(shop.owner_email)+'</p><p>Status: '+escape(shop.verification_status)+(shop.registration_reference?' · Reference: '+escape(shop.registration_reference):'')+'</p>'+(shop.submitted_at?'<p>Submitted '+escape(shop.submitted_at)+'</p>':'')+(shop.verification_status==='pending'?'<img class="business-review-photo" src="/api/v1/admin/shops/'+escape(shop.id)+'/document" alt="Encrypted business document for '+escape(shop.name)+'">':'')+'<label class="auth-field">Review reason<input data-business-reason="'+escape(shop.id)+'" maxlength="500"></label><div class="nl-controls"><button class="btn primary" data-business-status="verified" data-shop="'+escape(shop.id)+'">Verify business</button><button class="btn" data-business-status="suspended" data-shop="'+escape(shop.id)+'">Suspend business</button></div></article>').join('')||'<p>No business submissions yet.</p>');
  } catch(error) {if(root.isConnected)root.innerHTML='<h2>Business verification queue</h2><p role="alert">'+escape(error.message)+'</p>';}
}
async function loadAvailability() {
  const rows=activity.listings.filter(item=>item.kind==='gear');
  await Promise.all(rows.map(async item=>{
    const root=document.querySelector('[data-calendar-listing="'+item.id+'"] .availability-list');if(!root)return;
    try {const blocks=await api('/listings/'+item.id+'/availability');if(!root.isConnected)return;
      root.innerHTML=blocks.map(block=>'<div class="nl-record"><strong>'+escape(block.start_date)+' to '+escape(block.end_date)+'</strong> · '+(block.source==='owner_block'?'Owner blocked':'Rental booking')+(block.source==='owner_block'?' <button class="btn" data-unblock="'+item.id+'" data-block-id="'+escape(block.id||'')+'">Remove block</button>':'')+'</div>').join('')||'<p>No dates blocked.</p>';
    } catch(error) {root.textContent='Availability could not be loaded: '+error.message;}
  }));
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
      await loadAdminConsole(center);
    }
  } catch(error) { center.textContent='Identity verification is temporarily unavailable.'; }
}
async function loadAdminConsole(center) {
  const root=document.createElement('section');root.className='admin-console';root.innerHTML='<h2>Marketplace operations</h2><p>Private admin workspace · sensitive documents are access-audited.</p><p>Loading reports, claims and money records…</p>';center.append(root);
  try {
    const [metrics,claims,users,listings,ledger]=await Promise.all([api('/admin/dashboard'),api('/admin/claims'),api('/admin/users'),api('/admin/listings'),api('/admin/ledger?limit=50')]);
    if (!root.isConnected||!user?.admin) return;
    const percent=value=>(Number(value||0)*100).toFixed(1)+'%';
    const money=value=>'₹'+(Number(value||0)/100).toLocaleString('en-IN',{maximumFractionDigits:2});
    const stats=[['Members',metrics.users.total],['Verified email + phone',metrics.users.verified],['Active listings',metrics.listings.active],['Paid rentals',metrics.rentals.captured],['Open claims',metrics.disputes.open],['Dispute rate',percent(metrics.disputes.rate)],['Loss rate',percent(metrics.disputes.lossRate)],['Repeat renter rate',percent(metrics.rentals.repeatRate)],['Commission recorded',money(metrics.revenueMinor)]];
    const claimCards=claims.map(claim=>{
      const evidence=[...claim.evidence.map(row=>({...row,label:row.phase+' photo',url:'/api/v1/requests/'+claim.booking+'/evidence/'+encodeURIComponent(row.id)})),...claim.claimEvidence.map(row=>({...row,label:'Owner claim photo',url:'/api/v1/requests/'+claim.booking+'/claim-evidence/'+encodeURIComponent(row.id)}))].map(row=>'<figure><a target="_blank" rel="noopener" href="'+row.url+'"><img loading="lazy" src="'+row.url+'" alt="'+escape(row.label)+' uploaded by '+escape(row.name)+'"></a><figcaption><strong>'+escape(row.label)+'</strong><br>'+escape(row.name)+' · '+escape(new Date(row.uploaded_at).toLocaleString())+'</figcaption></figure>').join('')||'<p>No booking photos.</p>';
      const messages=claim.messages.map(row=>'<p><strong>'+escape(row.name)+'</strong> · '+escape(row.sent)+'<br>'+escape(row.body)+'</p>').join('')||'<p>No conversation messages.</p>';
      const history=claim.statusHistory.map(row=>'<li>'+escape(row.old_status)+' → '+escape(row.new_status)+' · '+escape(row.occurred_at)+'</li>').join('');
      const conditions=(()=>{try{return JSON.parse(claim.condition_checklist||'[]').map(escape).join(' · ')}catch{return ''}})();
      const decision=claim.resolution==='resolving'?' · Saved decision: '+escape(claim.resolution)+' ('+money(claim.deduction_minor)+')':'';
      return '<article class="admin-claim"><div class="nl-controls"><strong>Booking #'+claim.booking+' · '+escape(claim.claim_status)+'</strong><span>'+escape(claim.title)+' · '+escape(claim.start_date)+' to '+escape(claim.end_date)+'</span></div><p><strong>Owner:</strong> '+escape(claim.owner_name)+' ('+escape(claim.owner_email)+') · <strong>Renter:</strong> '+escape(claim.renter_name)+' ('+escape(claim.renter_email)+')</p><p><strong>Condition checklist:</strong> '+conditions+'</p><p><strong>Owner claim:</strong> '+escape(claim.reason)+'</p><p><strong>Renter response:</strong> '+escape(claim.renter_response||'Awaiting renter response')+'</p><p><strong>Deposit:</strong> '+money(claim.deposit_minor)+' · Payment '+escape(claim.payment_status||'unknown')+decision+' · Rent is settled separately.</p><details><summary>Claim, handover and return photo comparison</summary><div class="admin-evidence">'+evidence+'</div></details><details><summary>Conversation ('+claim.messages.length+')</summary>'+messages+'</details><details><summary>Booking history</summary><ol>'+history+'</ol></details><details><summary>Claim audit history</summary><ol>'+claim.claimHistory.map(row=>'<li>'+escape(row.event_type)+' · '+escape(row.occurred_at)+' · '+escape(row.event_data)+'</li>').join('')+'</ol></details>'+(claim.claim_status==='open'||claim.claim_status==='resolving'?'<div class="admin-resolution"><label class="auth-field">Deposit decision<select data-claim-decision="'+claim.booking+'"><option value="full_refund">Full deposit refund</option><option value="partial_deduction">Partial deposit deduction</option><option value="full_capture">Release full deposit to owner</option></select></label><label class="auth-field">Owner deduction in rupees<input data-claim-amount="'+claim.booking+'" type="number" min="0" step="0.01" max="'+(Number(claim.deposit_minor)/100)+'" value="0"></label><label class="auth-field">Decision note<input data-claim-reason="'+claim.booking+'" maxlength="800" value="'+escape(claim.resolution_reason||'')+'"></label><button class="btn primary" data-resolve-claim="'+claim.booking+'">'+(claim.claim_status==='resolving'?'Retry saved decision':'Resolve claim')+'</button></div>':'<p><strong>Decision:</strong> '+escape(claim.resolution||'')+' · '+escape(claim.resolution_reason||'')+'</p>')+'</article>';
    }).join('')||'<p>No rental claims.</p>';
    const userRows=users.map(row=>'<tr><td>'+escape(row.name)+'</td><td>'+escape(row.email)+'</td><td>'+escape(row.kyc_status||'unverified')+'</td><td>'+escape(row.completed_rentals)+'</td><td>'+escape(row.active_listings)+'</td></tr>').join('');
    const listingRows=listings.map(row=>'<tr><td>'+escape(row.title)+'</td><td>'+escape(row.kind)+' · '+escape(row.category)+'</td><td>'+escape(row.owner_name)+'</td><td>'+escape(row.area)+'</td><td>'+Number(row.active?'1':'0')+'</td></tr>').join('');
    const ledgerRows=ledger.map(row=>'<tr><td>'+escape(row.occurred_at)+'</td><td>#'+escape(row.booking??'—')+'</td><td>'+escape(row.event_type)+'</td><td>'+money(row.amount_minor)+'</td><td>'+escape(row.actor_name||'Automatic/provider')+'</td><td>'+escape(row.provider_reference||'—')+'</td></tr>').join('');
    root.innerHTML='<h2>Marketplace operations</h2><p>Private admin workspace · sensitive identity document access is recorded.</p><div class="admin-metrics">'+stats.map(([label,value])=>'<article><strong>'+escape(value)+'</strong><span>'+escape(label)+'</span></article>').join('')+'</div><h3>Rental claims</h3><p>Compare private condition photos, conversation and status history before deciding. Deposit decisions do not change the separately held rent payout.</p>'+claimCards+'<h3>Members</h3><div class="admin-table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Identity</th><th>Completed rentals</th><th>Active listings</th></tr></thead><tbody>'+userRows+'</tbody></table></div><h3>Listings</h3><div class="admin-table-wrap"><table><thead><tr><th>Item/service</th><th>Portal/category</th><th>Owner</th><th>Area</th><th>Active</th></tr></thead><tbody>'+listingRows+'</tbody></table></div><h3>Recent money ledger · last 50 entries</h3><div class="admin-table-wrap"><table><thead><tr><th>When</th><th>Booking</th><th>Event</th><th>Amount</th><th>Actor</th><th>Provider reference</th></tr></thead><tbody>'+ledgerRows+'</tbody></table></div>';
  } catch(error) { if(root.isConnected) root.innerHTML='<h2>Marketplace operations</h2><p role="alert">Admin data could not be loaded: '+escape(error.message)+'</p>'; }
}
async function refresh() {
  const [allListings,currentActivity,gearResults,helpResults] = await Promise.all([
    api('/listings'), user ? api('/activity') : Promise.resolve({saved:[],threads:[],listings:[],reports:[]}),
    portalFilters.gear?api(portalSearchUrl('gear',portalFilters.gear)):Promise.resolve(null),
    portalFilters.help?api(portalSearchUrl('help',portalFilters.help)):Promise.resolve(null)
  ]);
  items=allListings;activity=currentActivity;portalResults.gear=gearResults;portalResults.help=helpResults;
  render();
}
function navigate(next, updateHash = true) {
  if (!user && !['login','verify','reset'].includes(next)) { next = 'login'; updateHash = true; }
  if (user && !user.emailVerified && !['verify','login','reset'].includes(next)) { next = 'verify'; updateHash = true; }
  if (user && user.emailVerified && !user.profileComplete && !['profile','login','verify','reset'].includes(next)) { next = 'profile'; updateHash = true; }
  if (next === 'home') next = 'rentals';
  if (!views.includes(next)) next = 'landing';
  view = next;
  const currentToken=new URLSearchParams(location.search).get('token'),shopInvite=new URLSearchParams(location.search).get('shopInvite');
  let route = next === 'landing' ? '/' : next === 'login' ? '/login' : next === 'profile' ? '/profile' : next === 'verify' ? '/verify-email' + (currentToken ? '?token=' + encodeURIComponent(currentToken) : '') : next === 'reset' ? '/reset-password' + (currentToken ? '?token=' + encodeURIComponent(currentToken) : '') : '/#' + next;
  if(shopInvite) route+=(route.includes('?')?'&':'?')+'shopInvite='+encodeURIComponent(shopInvite);
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
    verifyForm.elements.token.value=currentToken && !/^\d{6}$/.test(currentToken) ? currentToken : '';
    verifyForm.elements.code.value=currentToken && /^\d{6}$/.test(currentToken) ? currentToken : '';
    verifyForm.elements.code.required=!verifyForm.elements.token.value;
    $('#verify-copy').textContent=user?.email ? 'Enter the six-digit code we sent to ' + user.email + '. It expires in 10 minutes.' : 'Enter the six-digit code from your email. It expires in 10 minutes.';
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
  if (thread.kind==='gear'&&thread.status==='disputed') {
    const claim=await api('/requests/'+id+'/claim');
    if (claim) {
      const panel=document.createElement('section');panel.className='nl-claim-summary';
      const title=document.createElement('h3');title.textContent='Rental claim · '+claim.status;panel.append(title);
      const reason=document.createElement('p');reason.textContent='Owner report: '+claim.reason;panel.append(reason);
      if (claim.renter_response) {const response=document.createElement('p');response.textContent='Your response: '+claim.renter_response;panel.append(response);}
      else if (!owner&&claim.status==='open') {
        const form=document.createElement('form');form.className='claim-response';form.innerHTML='<label class="auth-field">Your response to the owner\'s report<textarea name="response" required maxlength="1200" rows="4"></textarea></label><button class="btn primary" type="submit">Send response</button><p class="nl-error" role="alert"></p>';
        form.onsubmit=event=>{event.preventDefault();perform(async()=>{const button=form.querySelector('button');button.disabled=true;try{await api('/requests/'+id+'/claim','PATCH',{response:form.elements.response.value});await refresh();await openThread(id);}catch(error){form.querySelector('.nl-error').textContent=error.message;}finally{button.disabled=false;}});};panel.append(form);
      }
      if (claim.resolution) {const result=document.createElement('p');result.textContent='Admin decision: '+claim.resolution.replaceAll('_',' ')+' · '+(claim.resolution_reason||'');panel.append(result);}
      chat.append(panel);
    }
  }
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
  if (data.blockDates) {
    const booking=data.blockDates,form=document.querySelector('[data-calendar-listing="'+booking+'"] .availability-form');
    await api('/listings/'+booking+'/availability','POST',{startDate:form.elements.startDate.value,endDate:form.elements.endDate.value});
    await refresh();return toast('Those dates are now blocked for your listing.');
  }
  if(data.publish) {await api('/listings/'+data.publish+'/status','PATCH',{status:'published'});await refresh();return toast('Draft published.');}
  if(data.duplicate) {await api('/listings/'+data.duplicate+'/duplicate','POST',{});await refresh();return toast('A draft copy was created.');}
  if(data.shopRemove&&confirm('Remove this member from the shop?')) {await api('/shops/'+data.shopRemove+'/members/'+data.member,'DELETE');await refresh();return toast('Shop access removed.');}
  if(data.shopReport) {const report=await api('/shops/'+data.shopReport+'/reports');const output=document.querySelector('[data-report="'+data.shopReport+'"]');if(output){output.hidden=false;output.textContent=JSON.stringify(report,null,2);}return;}
  if(data.acceptShopInvite) {await api('/shop-invitations/'+data.acceptShopInvite+'/accept','POST',{});await refresh();return toast('You joined the shop team.');}
  if(data.businessStatus&&data.shop) {const reason=document.querySelector('[data-business-reason="'+data.shop+'"]')?.value||'';await api('/admin/shops/'+data.shop+'/verification','PATCH',{status:data.businessStatus,reason});await refresh();return toast('Business review saved to the audit trail.');}
  if (data.unblock&&data.blockId) {
    await api('/listings/'+data.unblock+'/availability/'+data.blockId,'DELETE');
    await refresh();return toast('Date block removed.');
  }
  if (data.resolveClaim) {
    const booking=Number(data.resolveClaim),decision=$('[data-claim-decision="'+booking+'"]').value;
    const rupees=Number($('[data-claim-amount="'+booking+'"]').value||0);
    if (!Number.isFinite(rupees)||rupees<0) throw Error('Enter a valid whole or decimal rupee amount.');
    await api('/admin/claims/'+booking+'/resolve','POST',{decision,deductionMinor:Math.round(rupees*100),reason:$('[data-claim-reason="'+booking+'"]').value});
    await refresh();return toast('Claim decision and payment ledger updated.');
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
async function applyPortalFilters(kind,controls) {
  const fields={category:controls.querySelector('[data-filter-category]').value,minPrice:controls.querySelector('[data-filter-min]').value,maxPrice:controls.querySelector('[data-filter-max]').value,startDate:controls.querySelector('[data-filter-start]').value,endDate:controls.querySelector('[data-filter-end]').value,minRating:controls.querySelector('[data-filter-rating]').value,sort:controls.querySelector('[data-filter-sort]').value,radius};
  portalFilters[kind]=fields;
  portalResults[kind]=await api(portalSearchUrl(kind,fields));
  render();
}
for (const name of ['home','services']) {
  const form = document.createElement('form');
  form.className = 'nl-controls';
  form.dataset.portal=name==='services'?'help':'gear';
  form.setAttribute('role','search');
  form.innerHTML = '<input type="search" aria-label="Search by neighbourhood or listing" placeholder="Search by neighbourhood or listing"><button class="btn">Search</button>';
  form.onsubmit = event => { event.preventDefault(); search(form.querySelector('input').value); };
  const controls = document.createElement('div');
  controls.className = 'nl-controls';
  controls.innerHTML = '<button type="button" class="btn" data-nearby>Use my location</button>' +
    '<label>Within <select aria-label="Distance"><option value="5">5 km</option><option value="10" selected>10 km</option><option value="25">25 km</option></select></label>' +
    '<button type="button" class="btn" data-clear>Show all</button><span class="nearby-status" role="status"></span>';
  const options=name==='services'?[['','All Help'],['Home repair','Home repair'],['Creative','Creative'],['Lessons','Lessons']]:[['','All Gear'],['Tools','Tools'],['Tech & Camera','Tech & Camera'],['Outdoors','Outdoors']];
  controls.insertAdjacentHTML('beforeend','<details class="nl-market-filters"><summary>Filter price, dates and rating</summary><div><label>Category<select data-filter-category>'+options.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select></label><label>Min price · ₹<input data-filter-min type="number" min="0" max="10000000"></label><label>Max price · ₹<input data-filter-max type="number" min="0" max="10000000"></label><label>Available from<input data-filter-start type="date"></label><label>Available to<input data-filter-end type="date"></label><label>Owner rating<select data-filter-rating><option value="0">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></label><label>Sort by<select data-filter-sort><option value="newest">Newest</option><option value="nearest">Nearest</option><option value="price">Lowest price</option><option value="rating">Highest rated</option></select></label><button type="button" class="btn primary" data-filter-apply>Apply filters</button></div></details>');
  controls.querySelector('[data-nearby]').onclick = () => perform(async () => {
    visitorLocation = await locate();
    await refresh();
  });
  controls.querySelector('select').onchange = event => {
    radius = Number(event.target.value);
    document.querySelectorAll('select[aria-label="Distance"]').forEach(select => select.value = String(radius));
    if (portalFilters[form.dataset.portal]) perform(()=>applyPortalFilters(form.dataset.portal,controls)); else render();
  };
  controls.querySelector('[data-filter-apply]').onclick=()=>perform(()=>applyPortalFilters(form.dataset.portal,controls));
  controls.querySelector('[data-clear]').onclick = () => { visitorLocation = null; if (portalFilters[form.dataset.portal]) perform(()=>applyPortalFilters(form.dataset.portal,controls)); else render(); };
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
    await acceptShopInviteFromLink();
    if (view === 'messages') await openThread(threadId);
  } finally { document.body.classList.remove('auth-loading'); }
});
