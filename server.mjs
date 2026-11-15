import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase } from './database.mjs';
import { createObjectStorage, MAX_IMAGE_BYTES, validateImage } from './storage.mjs';
import { sendEmail, takeTestMessages } from './email.mjs';
import { sendSms, takeTestMessages as takeTestSms } from './sms.mjs';
import { createKycAdapter } from './kyc.mjs';
import { createPaymentAdapter } from './payments.mjs';

const query = await openDatabase();
const storage = await createObjectStorage();
const kyc = createKycAdapter();
const payments = createPaymentAdapter();
const secure = process.env.COOKIE_SECURE === '1';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const all = async (sql, ...args) => (await query(sql, ...args)).rows;
const get = async (sql, ...args) => (await all(sql, ...args))[0];
const run = async (sql, ...args) => query(sql, ...args);
const shopRole=async(shopId,userId)=>get('SELECT role FROM business_members WHERE shop_id=? AND user_id=?',shopId,userId);
async function requireShopRole(shopId,userId,roles=['owner','manager','staff']) {
  const member=await shopRole(shopId,userId);
  if(!member||!roles.includes(member.role)) fail(403,'You do not have permission for this shop.');
  return member.role;
}
let notificationBusy=false;
async function processNotifications() {
  if (notificationBusy) return;
  notificationBusy=true;
  try {
    const now=new Date().toISOString();
    await run("UPDATE notification_outbox SET status='pending',locked_at=NULL WHERE status='sending' AND locked_at<?",new Date(Date.now()-600000).toISOString());
    const pending=await all("SELECT * FROM notification_outbox WHERE status='pending' AND available_at<=? ORDER BY created_at LIMIT 15",now);
    for (const message of pending) {
      const claimed=await run("UPDATE notification_outbox SET status='sending',locked_at=? WHERE id=? AND status='pending'",now,message.id);
      if (!claimed.changes) continue;
      try {
        await sendEmail({to:message.recipient_email,subject:message.subject,text:message.body});
        await run("UPDATE notification_outbox SET status='sent',sent_at=?,locked_at=NULL,last_error=NULL WHERE id=? AND status='sending'",new Date().toISOString(),message.id);
      } catch(error) {
        const attempts=Number(message.attempts||0)+1,delay=Math.min(86400000,30000*2**Math.min(attempts,10));
        await run("UPDATE notification_outbox SET status=?,attempts=?,available_at=?,locked_at=NULL,last_error=? WHERE id=? AND status='sending'",attempts>=8?'failed':'pending',attempts,new Date(Date.now()+delay).toISOString(),String(error.message||'Email delivery failed.').slice(0,500),message.id);
      }
    }
  } finally { notificationBusy=false; }
}
async function queueNotification(userId,eventKey,subject,body) {
  const recipient=await get('SELECT email FROM users WHERE id=? AND email_verified_at IS NOT NULL',userId);
  if (!recipient) return;
  const now=new Date().toISOString();
  await run('INSERT INTO notification_outbox(id,event_key,recipient_email,subject,body,available_at,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING',randomUUID(),eventKey,recipient.email,subject.slice(0,180),body.slice(0,2000),now,now);
  void processNotifications().catch(error=>console.error('Notification delivery worker failed:',error.message));
}
function notifyUser(userId,eventKey,subject,body) {
  void queueNotification(userId,eventKey,subject,body).catch(error=>console.error('Could not queue email notification:',error.message));
}
const listings = 'SELECT l.id,l.owner,l.shop_id,l.quantity_available,l.listing_status,l.kind,l.title,l.category,l.price,l.item_value_minor,l.condition_checklist,l.area,l.latitude,l.longitude,l.description,l.active,(l.photo IS NOT NULL OR l.photo_key IS NOT NULL) AS hasPhoto,(SELECT COUNT(*) FROM demo_listing_photos dp WHERE dp.listing=l.id) AS demo_extra_photos,u.name,(SELECT AVG(br.score) FROM booking_ratings br WHERE br.ratee_user_id=l.owner) AS gear_rating,(SELECT COUNT(*) FROM booking_ratings br WHERE br.ratee_user_id=l.owner) AS gear_rating_count,(SELECT AVG(rt.score) FROM ratings rt JOIN requests rr ON rr.id=rt.booking JOIN listings rl ON rl.id=rr.listing WHERE rl.owner=l.owner) AS hire_rating,(SELECT COUNT(*) FROM ratings rt JOIN requests rr ON rr.id=rt.booking JOIN listings rl ON rl.id=rr.listing WHERE rl.owner=l.owner) AS hire_rating_count FROM listings l JOIN users u ON u.id=l.owner';
const threads = 'SELECT r.*,(SELECT payment_status FROM protected_payments WHERE booking=r.id) AS payment_status,(SELECT score FROM booking_ratings WHERE booking=r.id AND rater_user_id=r.requester) AS requester_score,(SELECT score FROM booking_ratings WHERE booking=r.id AND rater_user_id=l.owner) AS owner_score,l.price AS listing_price,l.condition_checklist,l.deposit_override_minor,l.title,l.owner,l.kind,u.name AS "requesterName",o.name AS "ownerName" FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=r.requester JOIN users o ON o.id=l.owner';
const assets = new Map([['/', ['index.html','text/html']], ['/login', ['index.html','text/html']], ['/profile', ['index.html','text/html']], ['/verify-email', ['index.html','text/html']], ['/reset-password', ['index.html','text/html']], ['/terms',['terms.html','text/html']], ['/privacy',['privacy.html','text/html']], ['/cancellation-refunds',['cancellation-refunds.html','text/html']], ['/banned-items',['banned-items.html','text/html']], ['/landing.html', ['landing.html','text/html']], ['/landing.js', ['landing.js','text/javascript']], ['/borrow.html', ['borrow.html','text/html']], ['/borrow.js', ['borrow.js','text/javascript']], ['/portal.js', ['portal.js','text/javascript']], ['/portal.css', ['portal.css','text/css']], ['/policy.css',['policy.css','text/css']], ['/app.js',['app.js','text/javascript']], ['/app.css',['app.css','text/css']]]);
for (const name of ['camera','tent','bicycle']) {
  assets.set('/examples/' + name + '.jpg', ['photos/' + name + '.jpg','image/jpeg']);
}
const attempts = new Map();
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function distanceKm(latitude,longitude,otherLatitude,otherLongitude) {
  const radians=value=>value*Math.PI/180,lat=radians(Number(otherLatitude)-Number(latitude)),lon=radians(Number(otherLongitude)-Number(longitude));
  const a=Math.sin(lat/2)**2+Math.cos(radians(Number(latitude)))*Math.cos(radians(Number(otherLatitude)))*Math.sin(lon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
function throttle(key,limit=20) {
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
  const entry = attempts.get(key) || { count: 0, until: now + 600000 };
  attempts.set(key, entry);
  if (++entry.count > limit) fail(429, 'Too many attempts. Try again in 10 minutes.');
}
async function json(req) {
  if (req.headers['content-type'] !== 'application/json') fail(415, 'Expected JSON.');
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1500000) fail(413, 'The submitted data is too large.');
    parts.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value;
  } catch { fail(400, 'Invalid JSON.'); }
}
function field(data, key, limit, required = true) {
  const value = typeof data[key] === 'string' ? data[key].trim() : '';
  if ((required && !value) || value.length > limit) fail(400, 'Check the ' + key + ' field.');
  return value;
}
async function session(res, user) {
  const token = randomBytes(32).toString('hex');
  await run('DELETE FROM sessions WHERE expires<=?', Date.now());
  await run('INSERT INTO sessions VALUES(?,?,?)', digest(token), user, Date.now() + 604800000);
  cookie(res, token, 604800);
}
function cookie(res, token, age) {
  res.setHeader('Set-Cookie', 'nl_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + (secure ? '; Secure' : ''));
}
function sessionToken(req) {
  return req.headers.cookie?.match(/(?:^|; )nl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
async function sessionUser(req) {
  const token = sessionToken(req);
  return token ? await get('SELECT u.id,u.name,u.email,u.phone,u.phone_verified_at AS "phoneVerifiedAt",u.kyc_status AS "kycStatus",(u.profile_photo IS NOT NULL OR u.profile_photo_key IS NOT NULL) AS "hasProfilePhoto",(u.email_verified_at IS NOT NULL) AS "emailVerified",(u.email_verified_at IS NOT NULL AND u.phone_verified_at IS NOT NULL AND (u.profile_photo IS NOT NULL OR u.profile_photo_key IS NOT NULL)) AS "profileComplete" FROM sessions s JOIN users u ON u.id=s."user" WHERE token=? AND expires>?', digest(token), Date.now()) : null;
}
async function trustProfile(userId) {
  const [rental,ratings,settingRows]=await Promise.all([
    get("SELECT COUNT(*) AS count FROM requests WHERE requester=? AND status IN ('completed','resolved')",userId),
    get('SELECT AVG(score) AS average FROM (SELECT rate.score AS score FROM ratings rate JOIN requests r ON r.id=rate.booking JOIN listings l ON l.id=r.listing WHERE l.owner=? UNION ALL SELECT br.score FROM booking_ratings br WHERE br.ratee_user_id=?) received_ratings',userId,userId),
    all("SELECT setting_key,setting_value FROM marketplace_settings WHERE setting_key IN ('established_renter_completed_rentals','trust_score_minimum','trust_score_maximum','new_renter_max_item_value_minor')")
  ]);
  const settings=Object.fromEntries(settingRows.map(row=>[row.setting_key,Number(row.setting_value)]));
  const completedRentals=Number(rental?.count || 0);
  const averageRating=ratings?.average == null ? null : Number(ratings.average);
  const trustScore=Math.max(0,Math.min(settings.trust_score_maximum || 100,40+completedRentals*10+(averageRating == null ? 0 : Math.round((averageRating-3)*8))));
  const newRenter=completedRentals<(settings.established_renter_completed_rentals || 3)||trustScore<(settings.trust_score_minimum || 65);
  return {completedRentals,averageRating,trustScore,newRenter,maxItemValueMinor:settings.new_renter_max_item_value_minor || 2000000};
}
function emailOrigin(req) {
  const origin = process.env.PUBLIC_ORIGIN || req.headers.origin || 'http://' + req.headers.host;
  const url = new URL(origin);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(500,'PUBLIC_ORIGIN must be a website origin.');
  if (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || !process.env.PUBLIC_ORIGIN)) fail(500,'Production email links require PUBLIC_ORIGIN with HTTPS.');
  return url.origin;
}
async function issueEmailToken(req,user,kind) {
  const isEmailCode = kind === 'verify';
  const developmentCodeEnabled = process.env.NODE_ENV === 'development' && process.env.EMAIL_PROVIDER === 'mock' && process.env.ALLOW_DEV_EMAIL_OTP === '1';
  const token = isEmailCode ? (developmentCodeEnabled && /^\d{6}$/.test(process.env.EMAIL_OTP_DEV_CODE || '') ? process.env.EMAIL_OTP_DEV_CODE : String(randomInt(0,1000000)).padStart(6,'0')) : randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + (isEmailCode ? 10 : 60) * 60 * 1000).toISOString();
  const table = kind === 'verify' ? 'email_verification_tokens' : 'password_reset_tokens';
  await run('UPDATE ' + table + ' SET used_at=? WHERE user_id=? AND used_at IS NULL',now.toISOString(),user.id);
  await run('INSERT INTO ' + table + '(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',digest(token),user.id,expires,now.toISOString());
  const route = isEmailCode ? '/verify-email' : '/reset-password';
  const url = emailOrigin(req) + route + '?token=' + encodeURIComponent(token);
  const subject = isEmailCode ? 'Your NeighbourLink confirmation code' : 'Reset your NeighbourLink password';
  const action = isEmailCode ? 'Confirm email' : 'Choose a new password';
  const text = isEmailCode ? 'Your NeighbourLink confirmation code is ' + token + '.\nEnter it on the confirmation screen. It expires in 10 minutes.' : 'Reset your password: ' + url + '\nThis link expires in 1 hour.';
  const html = isEmailCode ? '<p>Enter this code to confirm your NeighbourLink email:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">' + token + '</p><p>This code expires in 10 minutes.</p>' : '<p>' + action + ' for your NeighbourLink account.</p><p><a href="' + url + '">' + action + '</a></p><p>This link expires in 1 hour.</p>';
  try { await sendEmail({to:user.email,subject,text,html}); }
  catch (error) { fail(503,error.message || 'Email delivery is unavailable.'); }
  return developmentCodeEnabled && isEmailCode ? token : undefined;
}
async function readImageRequest(req) {
  const contentType = req.headers['content-type']?.toLowerCase();
  let size=0;
  const parts=[];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) fail(413,'Images must be 1 MB or smaller.');
    parts.push(chunk);
  }
  const bytes=Buffer.concat(parts);
  const image=validateImage(bytes,contentType);
  return {bytes,contentType,image};
}
async function settingValues(keys) {
  const rows=await all('SELECT setting_key,setting_value FROM marketplace_settings WHERE setting_key IN ('+keys.map(()=>'?').join(',')+')',...keys);
  return Object.fromEntries(rows.map(row=>[row.setting_key,Number(row.setting_value)]));
}
async function depositQuote(listing,requester,startDate,endDate) {
  const days=Math.max(1,Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1);
  const trust=await trustProfile(requester);
  const keyCategory=listing.category==='Tools'?'deposit_category_multiplier_tools':listing.category==='Tech & Camera'?'deposit_category_multiplier_tech':listing.category==='Outdoors'?'deposit_category_multiplier_outdoors':'deposit_category_multiplier_default';
  const settings=await settingValues(['deposit_base_percent','trust_multiplier_unverified','trust_multiplier_trusted','deposit_min_minor','deposit_max_minor',keyCategory,'deposit_duration_multiplier_7_days','deposit_long_duration_days','deposit_owner_override_max_percent','max_rental_days']);
  if (days>(settings.max_rental_days||30)) fail(400,'Gear rentals can be requested for up to '+(settings.max_rental_days||30)+' days.');
  const trustFactor=trust.newRenter||trust.completedRentals===0?(settings.trust_multiplier_unverified||1.5):(settings.trust_multiplier_trusted||1);
  const categoryFactor=settings[keyCategory]||1;
  const durationFactor=days>(settings.deposit_long_duration_days||7)?(settings.deposit_duration_multiplier_7_days||1.1):1;
  const raw=Math.round(Number(listing.item_value_minor)*(settings.deposit_base_percent||25)/100*trustFactor*categoryFactor*durationFactor);
  const min=settings.deposit_min_minor||0,max=settings.deposit_max_minor||Number.MAX_SAFE_INTEGER;
  let amount=Math.max(min,Math.min(max,raw));
  if (listing.deposit_override_minor!=null) {
    const maxDelta=Math.round(amount*(settings.deposit_owner_override_max_percent||50)/100);
    amount=Math.max(min,Math.min(max,Math.max(amount-maxDelta,Math.min(amount+maxDelta,Number(listing.deposit_override_minor)))));
  }
  return {amount,days,multiplier:Number((trustFactor*categoryFactor*durationFactor).toFixed(4)),settings};
}
async function recordPaymentCaptured(paymentRow,paymentId,actorUserId=null) {
  const payment=await payments.findPayment(paymentId);
  if (!payment?.captured || payment.status!=='captured' || payment.order_id!==paymentRow.provider_order_id || Number(payment.amount)!==Number(paymentRow.amount_minor) || payment.currency!=='INR') fail(400,'The provider payment could not be verified.');
  const transfers=await payments.transfers(paymentId);
  const rentTransfer=transfers.find(row=>row.notes?.part==='rental'||Number(row.amount)===Number(paymentRow.rent_minor)-Number(paymentRow.commission_minor))||transfers[0];
  const depositTransfer=transfers.find(row=>row.notes?.part==='deposit'||Number(row.amount)===Number(paymentRow.deposit_minor))||transfers[1];
  if (!rentTransfer?.id || !depositTransfer?.id || Number(rentTransfer.amount)!==Number(paymentRow.rent_minor)-Number(paymentRow.commission_minor) || Number(depositTransfer.amount)!==Number(paymentRow.deposit_minor) || rentTransfer.on_hold!==true || depositTransfer.on_hold!==true) fail(503,'The provider did not confirm the required held transfers. Contact support before retrying.');
  const now=new Date().toISOString();let bookingChanged=false;
  await query.transaction(async tx=>{
    const changed=await tx("UPDATE protected_payments SET provider_payment_id=?,payment_status='captured',rental_transfer_id=?,deposit_transfer_id=?,updated_at=? WHERE booking=? AND payment_status IN ('created','failed')",paymentId,rentTransfer.id,depositTransfer.id,now,paymentRow.booking);
    if (changed.changes) {
      bookingChanged=true;
      await tx("UPDATE requests SET status='paid' WHERE id=? AND status='accepted'",paymentRow.booking);
      await tx("INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?, 'accepted','paid',?,'{}')",paymentRow.booking,actorUserId,now);
      const events=[['capture',paymentRow.amount_minor,'capture','customer payment'],['hold',paymentRow.rent_minor-paymentRow.commission_minor,'rent-hold','rental transfer'],['hold',paymentRow.deposit_minor,'deposit-hold','refundable deposit'],['commission',paymentRow.commission_minor,'commission','platform share']];
      for (const [type,amount,key,part] of events) if (amount>0) await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,actor_user_id,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)',paymentRow.booking,type,amount,'INR','razorpay',key==='capture'?paymentId:key==='rent-hold'?rentTransfer.id:key==='deposit-hold'?depositTransfer.id:paymentRow.provider_order_id,'booking:'+paymentRow.booking+':'+key,actorUserId,JSON.stringify({paymentId,part}),now);
    }
  });
  if (bookingChanged) {
    const parties=await get('SELECT r.requester,l.owner,l.title FROM requests r JOIN listings l ON l.id=r.listing WHERE r.id=?',paymentRow.booking);
    if (parties) for (const recipient of [parties.requester,parties.owner]) notifyUser(recipient,'booking:'+paymentRow.booking+':paid','Rental payment confirmed',parties.title+' is paid. Arrange handover and submit timestamped photos with the other neighbour.');
  }
  return {ok:true,status:'paid'};
}
async function cancelPaidBooking(bookingId,actorUserId) {
  if (!payments) fail(409,'This paid booking cannot be cancelled.');
  const claimedAt=new Date().toISOString();
  const claimed=await run("UPDATE protected_payments SET settlement_status='cancelling',settlement_started_at=?,updated_at=? WHERE booking=? AND payment_status='captured' AND settlement_status='open'",claimedAt,claimedAt,bookingId);
  if (!claimed.changes) fail(409,'This booking payment is already being settled or cancelled. Refresh and try again.');
  try {
    const payment=await get('SELECT * FROM protected_payments WHERE booking=? AND settlement_status=?',bookingId,'cancelling');
    if (!payment) fail(409,'This paid booking cannot be cancelled.');
    for (const transferId of [payment.rental_transfer_id,payment.deposit_transfer_id]) {
      if (!transferId) fail(503,'A provider transfer is missing. Contact support before retrying.');
      const transfer=await payments.fetchTransfer(transferId);
      if (!transfer) fail(503,'A provider transfer could not be fetched. Contact support before retrying.');
      const remaining=Number(transfer.amount)-Number(transfer.amount_reversed||0);
      if (remaining>0) await payments.reverseTransfer(transferId,remaining);
    }
    const current=await payments.findPayment(payment.provider_payment_id);
    const refundRemaining=Number(payment.amount_minor)-Number(current?.amount_refunded||0);
    let refund=null;
    if (refundRemaining>0) refund=await payments.refund(payment.provider_payment_id,refundRemaining);
    const now=new Date().toISOString();
    await query.transaction(async tx=>{
      const changed=await tx("UPDATE requests SET status='cancelled' WHERE id=? AND status='paid'",bookingId);
      if (!changed.changes) fail(409,'The booking changed while cancellation was processing.');
      const settled=await tx("UPDATE protected_payments SET settlement_status='cancelled',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='cancelling'",now,bookingId);
      if (!settled.changes) fail(409,'The payment status changed. Contact support to reconcile cancellation.');
      await tx('INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,\'paid\',\'cancelled\',?,?)',bookingId,actorUserId,now,JSON.stringify({policy:'full_refund_before_free_cancellation_cutoff'}));
      const cancellationEvents=[['transfer_reversal',payment.rent_minor-payment.commission_minor,payment.rental_transfer_id,'rent-reversal'],['transfer_reversal',payment.deposit_minor,payment.deposit_transfer_id,'deposit-reversal'],['release',payment.rent_minor-payment.commission_minor+payment.deposit_minor,payment.provider_payment_id,'release'],['commission_refund',payment.commission_minor,payment.provider_payment_id,'commission-refund'],['refund',refundRemaining,payment.provider_payment_id,'customer-refund']];
      for (const [kind,amount,ref,key] of cancellationEvents) if (amount>0) await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,actor_user_id,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)',bookingId,kind,amount,'INR','razorpay',ref,'booking:'+bookingId+':cancel:'+key,actorUserId,JSON.stringify({providerResult:refund?.id||null}),now);
    });
    return {ok:true,status:'cancelled',refundedMinor:refundRemaining};
  } catch(error) {
    await run("UPDATE protected_payments SET settlement_status='open',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='cancelling'",new Date().toISOString(),bookingId).catch(()=>{});
    throw error;
  }
}
let claimWorkerBusy=false;
async function processClaimWindows() {
  if (claimWorkerBusy||!payments) return;
  claimWorkerBusy=true;
  try {
    const staleBefore=new Date(Date.now()-120000).toISOString();
    await run("UPDATE protected_payments SET settlement_status='open',settlement_started_at=NULL,updated_at=? WHERE settlement_status IN ('settling','cancelling') AND settlement_started_at<?",new Date().toISOString(),staleBefore);
    const due=await all("SELECT r.id,l.owner,p.provider_payment_id,p.rental_transfer_id,p.deposit_transfer_id,p.deposit_minor,p.rent_minor,p.commission_minor,COALESCE(f.amount_minor,0) AS late_fee_minor,a.account_id AS owner_account_id,p.settlement_status FROM requests r JOIN listings l ON l.id=r.listing JOIN protected_payments p ON p.booking=r.id LEFT JOIN booking_late_fees f ON f.booking=r.id LEFT JOIN owner_payment_accounts a ON a.user_id=l.owner AND a.provider='razorpay' WHERE r.status='claim_window' AND r.claim_deadline<=? AND p.payment_status='captured' AND p.settlement_status='open'",new Date().toISOString());
    for (const booking of due) {
      const started=new Date().toISOString();
      const claimed=await run("UPDATE protected_payments SET settlement_status='settling',settlement_started_at=?,updated_at=? WHERE booking=? AND settlement_status='open'",started,started,booking.id);
      if (!claimed.changes) continue;
      try {
        if (!booking.rental_transfer_id||!booking.deposit_transfer_id||!booking.provider_payment_id) fail(503,'Required provider transfer references are missing.');
        await payments.setHold(booking.rental_transfer_id,false);
        const depositTransfer=await payments.fetchTransfer(booking.deposit_transfer_id);
        if (!depositTransfer) fail(503,'Deposit transfer could not be fetched.');
        const reversible=Number(depositTransfer.amount)-Number(depositTransfer.amount_reversed||0);
        const reversal=reversible>0?await payments.reverseTransfer(booking.deposit_transfer_id,reversible):{id:booking.deposit_transfer_id};
        const current=await payments.findPayment(booking.provider_payment_id);
        if (!current) fail(503,'Payment could not be fetched for the deposit refund.');
        const lateFee=Math.min(Number(booking.deposit_minor),Number(booking.late_fee_minor||0));
        let lateFeeTransfer=null;
        if (lateFee>0) {
          if (!booking.owner_account_id) fail(503,'The seller payout account is unavailable for the assessed late fee.');
          lateFeeTransfer=await payments.createPaymentTransfer(booking.provider_payment_id,{booking:booking.id,accountId:booking.owner_account_id,amount:lateFee});
        }
        const refundAmount=Number(booking.deposit_minor)-lateFee;
        if (Number(current.amount_refunded||0)<refundAmount) await payments.refund(booking.provider_payment_id,refundAmount-Number(current.amount_refunded||0));
        const now=new Date().toISOString();
        await query.transaction(async tx=>{
          const payment=await tx("UPDATE protected_payments SET settlement_status='settled',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='settling'",now,booking.id);
          if (!payment.changes) fail(409,'The settlement was claimed by another worker.');
          const completed=await tx("UPDATE requests SET status='completed',completed_at=? WHERE id=? AND status='claim_window'",now,booking.id);
          if (!completed.changes) fail(409,'The booking state changed during automatic settlement.');
          await tx("INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,NULL,'claim_window','completed',?,?)",booking.id,now,JSON.stringify({automatic:true}));
          if (lateFeeTransfer) await tx("UPDATE booking_late_fees SET owner_transfer_id=?,status='paid' WHERE booking=? AND status='assessed'",lateFeeTransfer.id,booking.id);
          const events=[['payout',Number(booking.rent_minor)-Number(booking.commission_minor),booking.rental_transfer_id,'rent-payout'],['transfer_reversal',Number(booking.deposit_minor),reversal.id||booking.deposit_transfer_id,'deposit-reversal'],['release',Number(booking.deposit_minor),reversal.id||booking.deposit_transfer_id,'deposit-release'],['late_fee_payout',lateFee,lateFeeTransfer?.id,'late-fee-payout'],['refund',refundAmount,booking.provider_payment_id,'deposit-refund']];
          for (const [type,amount,reference,key] of events) if (amount>0) await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',booking.id,type,amount,'INR','razorpay',reference,'booking:'+booking.id+':'+key,JSON.stringify({automatic:true}),now);
        });
      } catch(error) {
        await run("UPDATE protected_payments SET settlement_status='open',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='settling'",new Date().toISOString(),booking.id).catch(()=>{});
        console.error('Booking settlement needs attention:',booking.id,error.message);
      }
    }
  } finally { claimWorkerBusy=false; }
}
async function handlePaymentWebhook(req,res) {
  let size=0;const chunks=[];
  for await (const chunk of req) { size+=chunk.length;if(size>2_000_000) fail(413,'Webhook payload is too large.');chunks.push(chunk); }
  const raw=Buffer.concat(chunks),signature=req.headers['x-razorpay-signature'],eventId=req.headers['x-razorpay-event-id'];
  if (!payments||typeof eventId!=='string'||eventId.length>100||!/^[A-Za-z0-9_:-]+$/.test(eventId)||typeof signature!=='string'||!payments.verifyWebhook(raw,signature)) fail(400,'Invalid payment webhook signature.');
  if (await get('SELECT event_id FROM payment_webhook_events WHERE event_id=?',eventId)) return {ok:true,duplicate:true};
  let event;
  try { event=JSON.parse(raw.toString('utf8')); } catch { fail(400,'Invalid payment webhook body.'); }
  const subscriptionEntity=event?.payload?.subscription?.entity;
  if (subscriptionEntity?.id) {
    const shopSubscription=await get('SELECT shop_id,plan_key FROM shop_subscriptions WHERE provider_subscription_id=?',subscriptionEntity.id);
    if (shopSubscription) {
      const statusMap={'subscription.activated':'active','subscription.authenticated':'active','subscription.charged':'active','subscription.halted':'past_due','subscription.cancelled':'cancelled','subscription.completed':'cancelled'};
      const status=statusMap[event.event];
      const currentPeriodEnd=Number.isFinite(Number(subscriptionEntity.current_end))&&Number(subscriptionEntity.current_end)>0?new Date(Number(subscriptionEntity.current_end)*1000).toISOString():null;
      const paymentEntity=event?.payload?.payment?.entity;
      await query.transaction(async tx=>{
        if(status) await tx('UPDATE shop_subscriptions SET status=?,current_period_end=COALESCE(?,current_period_end),checkout_url=CASE WHEN ? IN (\'active\',\'cancelled\') THEN NULL ELSE checkout_url END,updated_at=? WHERE provider_subscription_id=?',status,currentPeriodEnd,status,new Date().toISOString(),subscriptionEntity.id);
        await tx('INSERT INTO shop_subscription_events(id,shop_id,provider_event_id,event_type,plan_key,occurred_at,metadata) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider_event_id) DO NOTHING',randomUUID(),shopSubscription.shop_id,eventId,field(event,'event',100),shopSubscription.plan_key,new Date().toISOString(),JSON.stringify({subscriptionId:subscriptionEntity.id}));
        if(event.event==='subscription.charged'&&paymentEntity?.id) await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,metadata,occurred_at) VALUES(NULL,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING','subscription_charge',Number(paymentEntity.amount)||0,paymentEntity.currency||'INR','razorpay',paymentEntity.id,'shop:'+shopSubscription.shop_id+':subscription:'+paymentEntity.id,JSON.stringify({shopId:shopSubscription.shop_id,planKey:shopSubscription.plan_key}),new Date().toISOString());
      });
    }
    const now=new Date().toISOString();
    await run('INSERT INTO payment_webhook_events(event_id,event_type,received_at,processed_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',eventId,field(event,'event',100),now,now);
    return {ok:true};
  }
  const entity=event?.payload?.payment?.entity;
  if (event.event==='payment.captured'&&entity?.id) {
    const paymentRow=await get('SELECT * FROM protected_payments WHERE provider_order_id=?',entity.order_id);
    if (paymentRow) await recordPaymentCaptured(paymentRow,entity.id,null);
  }
  const now=new Date().toISOString();
  await run('INSERT INTO payment_webhook_events(event_id,event_type,received_at,processed_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',eventId,field(event,'event',100),now,now);
  return {ok:true};
}
async function api(req, res, path) {
  const method = req.method;
  const token = sessionToken(req);
  const user = await sessionUser(req);
  const admin = Boolean(user && process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase());
  if (method !== 'GET') {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied.');
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_ORIGIN || 'http://' + req.headers.host;
    if (origin && origin !== expected) fail(403, 'Unexpected request origin.');
  }
  if (process.env.NODE_ENV === 'test' && method === 'GET' && path === '/__test/mailbox') {
    const recipient = new URL(req.url,'http://localhost').searchParams.get('to') || '';
    await processNotifications();
    return takeTestMessages(recipient);
  }
  if (process.env.NODE_ENV === 'test' && method === 'GET' && path === '/__test/sms') {
    const recipient = new URL(req.url,'http://localhost').searchParams.get('to') || '';
    return takeTestSms(recipient);
  }
  if (process.env.NODE_ENV === 'test' && method === 'GET' && path === '/__test/kyc-audit') {
    return {access:(await get('SELECT COUNT(*) AS count FROM kyc_access_audit')).count,reviews:(await get('SELECT COUNT(*) AS count FROM kyc_review_audit')).count};
  }
  if (process.env.NODE_ENV==='test'&&method==='POST'&&/^\/__test\/claim-window\/\d+\/expire$/.test(path)) {
    const id=Number(path.split('/')[3]);
    await run("UPDATE requests SET claim_deadline=? WHERE id=? AND status='claim_window'",new Date(Date.now()-1000).toISOString(),id);
    await processClaimWindows();
    return {status:(await get('SELECT status FROM requests WHERE id=?',id))?.status};
  }
  if (process.env.NODE_ENV==='test'&&method==='POST'&&/^\/__test\/booking-late\/\d+\/expire$/.test(path)) {
    const id=Number(path.split('/')[3]);
    await run('UPDATE requests SET due_at=? WHERE id=?',new Date(Date.now()-48*3600000).toISOString(),id);
    return {ok:true};
  }
  if (process.env.NODE_ENV==='test'&&method==='GET'&&/^\/__test\/ledger\/\d+$/.test(path)) return await all('SELECT event_type,amount_minor,provider_reference,idempotency_key FROM money_ledger WHERE booking=? ORDER BY id',Number(path.split('/')[3]));
  if (method === 'POST' && path === '/verify-email') {
    throttle('email-verify:' + req.socket.remoteAddress,30);
    const body=await json(req);
    const token = typeof body.token === 'string' && body.token ? body.token : String(body.code || '').trim();
    const validCode=/^\d{6}$/.test(token);
    const validLegacyLink=/^[A-Za-z0-9_-]{43}$/.test(token);
    if (!validCode && !validLegacyLink) fail(400,'Enter the six-digit code from your email.');
    const tokenHash=digest(token),now=new Date().toISOString();
    const record=await get('SELECT user_id FROM email_verification_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',tokenHash,now);
    if (!record) fail(400,'That code is invalid or expired. Request a new one and try again.');
    await query.transaction(async tx => {
      const used=await tx('UPDATE email_verification_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?',now,tokenHash,now);
      if (!used.changes) fail(400,'That code is invalid or expired. Request a new one and try again.');
      await tx('UPDATE users SET email_verified_at=? WHERE id=?',now,record.user_id);
    });
    return {ok:true};
  }
  if (method === 'POST' && path === '/password-reset') {
    throttle(req.socket.remoteAddress);
    const email=String((await json(req)).email || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const account=await get('SELECT id,email FROM users WHERE email=? AND email_verified_at IS NOT NULL',email);
      if (account) await issueEmailToken(req,account,'reset');
    }
    return {ok:true};
  }
  if (method === 'POST' && path === '/password-reset/complete') {
    const body=await json(req);
    const token=field(body,'token',64);
    const password=typeof body.password === 'string' ? body.password : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12 || password.length > 128) fail(400,'Use a valid reset link and a password of 12–128 characters.');
    const tokenHash=digest(token),now=new Date().toISOString();
    const record=await get('SELECT user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',tokenHash,now);
    if (!record) fail(400,'That reset link is invalid or expired.');
    const salt=randomBytes(16).toString('hex');
    const hashed=scryptSync(password,salt,64).toString('hex');
    await query.transaction(async tx => {
      const used=await tx('UPDATE password_reset_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?',now,tokenHash,now);
      if (!used.changes) fail(400,'That reset link is invalid or expired.');
      await tx('UPDATE users SET salt=?,password=? WHERE id=?',salt,hashed,record.user_id);
      await tx('DELETE FROM sessions WHERE "user"=?',record.user_id);
    });
    return {ok:true};
  }
  if (method === 'GET' && path === '/session') {
    if (!user) return null;
    const trust=await trustProfile(user.id);
    return {id:user.id,name:user.name,email:user.email,phone:user.phone,emailVerified:Boolean(user.emailVerified),phoneVerified:Boolean(user.phoneVerifiedAt),hasProfilePhoto:Boolean(user.hasProfilePhoto),profileComplete:Boolean(user.profileComplete),kycStatus:user.kycStatus || 'unverified',...trust,admin};
  }
  if (method === 'POST' && ['/signup', '/login'].includes(path)) {
    throttle(req.socket.remoteAddress);
    const body = await json(req);
    const email = field(body, 'email', 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) fail(400, 'Enter a valid email and a password of 12–128 characters.');
    let account = await get('SELECT * FROM users WHERE email=?', email);
    if (path === '/signup') {
      if (account) fail(409, 'An account already uses that email.');
      if (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase() && (!process.env.ADMIN_SIGNUP_CODE || body.adminCode !== process.env.ADMIN_SIGNUP_CODE)) fail(403, 'Admin registration requires its setup code.');
      const name = field(body, 'name', 80);
      const salt = randomBytes(16).toString('hex');
      account = await get('INSERT INTO users(name,email,salt,password) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id', name, email, salt, scryptSync(password, salt, 64).toString('hex'));
      if (!account) fail(409, 'An account already uses that email.');
    } else {
      const hashed = scryptSync(password, account?.salt || 'missing-account', 64);
      if (!account || !timingSafeEqual(hashed, Buffer.from(account.password, 'hex'))) fail(401, 'Email or password is incorrect.');
    }
    const devEmailCode = path === '/signup' ? await issueEmailToken(req,{id:account.id,email},'verify') : undefined;
    if (token) await run('DELETE FROM sessions WHERE token=?', digest(token));
    await session(res, account.id);
    return { ok: true, ...(devEmailCode ? {devEmailCode} : {}) };
  }
  if (!user) fail(401, 'Sign in to continue.');
  if (method === 'POST' && path === '/email-verification/resend') {
    if (!user.emailVerified) {
      throttle(req.socket.remoteAddress);
      const devEmailCode=await issueEmailToken(req,user,'verify');
      return {ok:true,...(devEmailCode ? {devEmailCode} : {})};
    }
    return {ok:true};
  }
  if (!user.emailVerified && !['/logout'].includes(path)) fail(403,'Confirm your email to continue.');
  if(method==='GET'&&path==='/shops/plans') return await all('SELECT plan_key,name,price_minor,max_active_listings,max_quantity_per_listing,monthly_reports FROM shop_subscription_plans WHERE active=1 ORDER BY price_minor');
  if(path==='/shops'&&method==='GET') return await all(`SELECT b.id,b.name,b.business_type,b.verification_status,m.role,s.plan_key,s.status AS subscription_status
    FROM business_members m JOIN business_accounts b ON b.id=m.shop_id LEFT JOIN shop_subscriptions s ON s.shop_id=b.id WHERE m.user_id=? ORDER BY b.created_at DESC`,user.id);
  if(path==='/shops'&&method==='POST') {
    if(!user.profileComplete) fail(403,'Finish your verified profile before creating a shop.');
    const body=await json(req),name=field(body,'name',100),businessType=field(body,'businessType',40);
    if(!['sole_proprietor','partnership','private_limited','cooperative','other'].includes(businessType)) fail(400,'Choose a supported business type.');
    const id=randomUUID(),now=new Date().toISOString();
    await query.transaction(async tx=>{
      await tx('INSERT INTO business_accounts(id,owner_user_id,name,business_type,registration_reference,verification_status,created_at) VALUES(?,?,?,?,?,\'unverified\',?)',id,user.id,name,businessType,field(body,'registrationReference',80,false),now);
      await tx('INSERT INTO business_members(shop_id,user_id,role,invited_by,created_at) VALUES(?,?,\'owner\',?,?)',id,user.id,user.id,now);
      await tx('INSERT INTO business_member_audit(shop_id,actor_user_id,subject_user_id,event_type,new_role,occurred_at) VALUES(?,?,?,\'created\',\'owner\',?)',id,user.id,user.id,now);
      await tx('INSERT INTO shop_subscriptions(shop_id,plan_key,status,created_at,updated_at) VALUES(?,\'community\',\'active\',?,?)',id,now,now);
    });
    return {id,name,businessType,role:'owner',verificationStatus:'unverified',planKey:'community'};
  }
  if(path==='/shop-invitations'&&method==='GET') return await all("SELECT i.id,i.shop_id,i.role,i.expires_at,b.name AS shop_name,u.name AS inviter_name FROM shop_member_invites i JOIN business_accounts b ON b.id=i.shop_id JOIN users u ON u.id=i.invited_by WHERE i.invitee_user_id=? AND i.status='pending' AND i.expires_at>? ORDER BY i.created_at DESC",user.id,new Date().toISOString());
  const acceptShopInvite=path.match(/^\/shop-invitations\/([a-f0-9-]{36})\/accept$/i);
  if(acceptShopInvite&&method==='POST') {
    if(!user.profileComplete) fail(403,'Complete your profile before joining a shop team.');
    const invite=await get("SELECT i.* FROM shop_member_invites i JOIN users u ON u.id=i.invitee_user_id WHERE i.id=? AND i.invitee_user_id=? AND lower(i.invitee_email)=lower(u.email) AND i.status='pending' AND i.expires_at>?",acceptShopInvite[1],user.id,new Date().toISOString());
    if(!invite) fail(404,'This shop invitation is unavailable or expired.');
    const now=new Date().toISOString();
    await query.transaction(async tx=>{
      const accepted=await tx("UPDATE shop_member_invites SET status='accepted',accepted_at=? WHERE id=? AND invitee_user_id=? AND status='pending' AND expires_at>?",now,invite.id,user.id,now);
      if(!accepted.changes) fail(409,'This invitation was already accepted or expired.');
      await tx('INSERT INTO business_members(shop_id,user_id,role,invited_by,created_at) VALUES(?,?,?,?,?)',invite.shop_id,user.id,invite.role,invite.invited_by,now);
      await tx('INSERT INTO business_member_audit(shop_id,actor_user_id,subject_user_id,event_type,new_role,occurred_at) VALUES(?,?,?,\'invitation_accepted\',?,?)',invite.shop_id,user.id,user.id,invite.role,now);
    });
    return {ok:true,shopId:invite.shop_id,role:invite.role};
  }
  const shopPath=path.match(/^\/shops\/([a-f0-9-]{36})(?:\/(.*))?$/i);
  if(shopPath) {
    const shopId=shopPath[1],action=shopPath[2]||'';
    const role=await requireShopRole(shopId,user.id);
    if(!action&&method==='GET') {
      const shop=await get('SELECT id,name,business_type,registration_reference,verification_status,submitted_at,decision_reason FROM business_accounts WHERE id=?',shopId);
      if(!shop) fail(404,'Shop unavailable.');
      if(role==='staff') {shop.registration_reference='';shop.decision_reason='';}
      const members=await all("SELECT m.user_id,m.role,u.name,u.email FROM business_members m JOIN users u ON u.id=m.user_id WHERE m.shop_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END",shopId);
      const pendingInvitations=role==='owner'||role==='manager'?await all("SELECT i.id,i.invitee_email,i.role,i.expires_at,u.name AS inviter_name FROM shop_member_invites i JOIN users u ON u.id=i.invited_by WHERE i.shop_id=? AND i.status='pending' AND i.expires_at>? ORDER BY i.created_at DESC",shopId,new Date().toISOString()):[];
      const subscription=await get('SELECT s.plan_key,s.status,s.current_period_end,s.checkout_url,p.name,p.price_minor,p.max_active_listings,p.max_quantity_per_listing,p.monthly_reports FROM shop_subscriptions s JOIN shop_subscription_plans p ON p.plan_key=s.plan_key WHERE s.shop_id=?',shopId);
      return {...shop,role,members,pendingInvitations,subscription,inventory:await all('SELECT id,title,kind,quantity_available,listing_status,active FROM listings WHERE shop_id=? ORDER BY id DESC',shopId)};
    }
    if(action==='verification'&&method==='POST') {
      if(role!=='owner') fail(403,'Only the shop owner can submit business verification.');
      const uploadId=field(await json(req),'uploadId',36),upload=await get("SELECT storage_key,content_type FROM uploads WHERE id=? AND user_id=? AND purpose='business-doc' AND consumed_at IS NULL AND created_at>?",uploadId,user.id,new Date(Date.now()-3600000).toISOString());
      if(!upload) fail(400,'Upload a current business registration document first.');
      const previous=await get('SELECT verification_status,verification_document_key FROM business_accounts WHERE id=?',shopId);if(!previous) fail(404,'Shop unavailable.');
      const now=new Date().toISOString();
      await query.transaction(async tx=>{
        const used=await tx("UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND purpose='business-doc' AND consumed_at IS NULL",now,uploadId,user.id);if(!used.changes) fail(400,'This document was already submitted.');
        await tx("UPDATE business_accounts SET verification_status='pending',verification_document_key=?,verification_document_type=?,submitted_at=?,reviewed_at=NULL,reviewer_user_id=NULL,decision_reason=NULL WHERE id=?",upload.storage_key,upload.content_type,now,shopId);
        await tx('INSERT INTO business_verification_audit(shop_id,actor_user_id,old_status,new_status,reason,occurred_at) VALUES(?,?,?,\'pending\',?,?)',shopId,user.id,previous.verification_status,'Documents submitted by shop owner.',now);
      });
      if(previous.verification_document_key) await storage.remove(previous.verification_document_key).catch(()=>{});
      return {ok:true,status:'pending'};
    }
    if(action==='members'&&method==='POST') {
      if(!['owner','manager'].includes(role)) fail(403,'Only owners and managers can manage staff.');
      const body=await json(req),email=field(body,'email',254).toLowerCase(),newRole=field(body,'role',20);
      if(!['manager','staff'].includes(newRole)||role==='manager'&&newRole!=='staff') fail(403,'Your role cannot assign that permission.');
      const target=await get('SELECT id,email FROM users WHERE email=? AND email_verified_at IS NOT NULL',email);if(!target) fail(404,'That person needs a verified NeighbourLink account first.');
      if(await shopRole(shopId,target.id)) fail(409,'This person already belongs to the shop.');
      const existingInvite=await get("SELECT role FROM shop_member_invites WHERE shop_id=? AND invitee_user_id=? AND status='pending' AND expires_at>?",shopId,target.id,new Date().toISOString());
      if(role==='manager'&&existingInvite?.role==='manager') fail(403,'Only the shop owner can manage manager invitations.');
      const inviteId=randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
      await run("INSERT INTO shop_member_invites(id,shop_id,invited_by,invitee_user_id,invitee_email,role,status,expires_at,created_at) VALUES(?,?,?,?,?,?,'pending',?,?) ON CONFLICT(shop_id,invitee_user_id) DO UPDATE SET id=excluded.id,invited_by=excluded.invited_by,invitee_email=excluded.invitee_email,role=excluded.role,status='pending',expires_at=excluded.expires_at,accepted_at=NULL,created_at=excluded.created_at",inviteId,shopId,user.id,target.id,target.email,newRole,expiresAt,now);
      await run('INSERT INTO business_member_audit(shop_id,actor_user_id,subject_user_id,event_type,new_role,occurred_at) VALUES(?,?,?,\'invited\',?,?)',shopId,user.id,target.id,newRole,now);
      const origin=process.env.PUBLIC_ORIGIN||'http://'+req.headers.host;
      notifyUser(target.id,'shop-invite:'+inviteId,'NeighbourLink shop invitation',user.name+' invited you to join '+(await get('SELECT name FROM business_accounts WHERE id=?',shopId)).name+' as '+newRole+'. Sign in to accept: '+origin+'/login?shopInvite='+inviteId);
      return {ok:true,invitationId:inviteId,role:newRole,status:'pending',expiresAt};
    }
    const memberDelete=action.match(/^members\/(\d+)$/);
    if(memberDelete&&method==='DELETE') {
      if(role!=='owner') fail(403,'Only the shop owner can remove staff.');
      const targetId=Number(memberDelete[1]),previous=await shopRole(shopId,targetId);if(!previous||previous.role==='owner') fail(404,'Shop staff member unavailable.');
      const now=new Date().toISOString();await query.transaction(async tx=>{await tx("DELETE FROM business_members WHERE shop_id=? AND user_id=? AND role<>'owner'",shopId,targetId);await tx('INSERT INTO business_member_audit(shop_id,actor_user_id,subject_user_id,event_type,old_role,occurred_at) VALUES(?,?,?,\'removed\',?,?)',shopId,user.id,targetId,previous.role,now);});return {ok:true};
    }
    if(action==='reports'&&method==='GET') {
      if(role==='staff') fail(403,'Manager or owner access is required for shop reports.');
      return {listings:await get('SELECT COUNT(*) AS total,COUNT(CASE WHEN active=1 THEN 1 END) AS published FROM listings WHERE shop_id=?',shopId),bookings:await get("SELECT COUNT(*) AS total,COUNT(CASE WHEN r.status IN ('completed','resolved') THEN 1 END) AS completed FROM requests r JOIN listings l ON l.id=r.listing WHERE l.shop_id=?",shopId),releasedThroughProviderMinor:Number((await get("SELECT COALESCE(SUM(CASE WHEN m.event_type IN ('payout','late_fee_payout') THEN m.amount_minor ELSE 0 END),0) AS amount FROM money_ledger m JOIN requests r ON r.id=m.booking JOIN listings l ON l.id=r.listing WHERE l.shop_id=?",shopId)).amount||0),inventory:await all('SELECT kind,listing_status,COUNT(*) AS listings,COALESCE(SUM(quantity_available),0) AS units FROM listings WHERE shop_id=? GROUP BY kind,listing_status',shopId)};
    }
    if(action==='subscription'&&method==='POST') {
      if(role!=='owner') fail(403,'Only the shop owner can change the subscription.');
      const planKey=field(await json(req),'planKey',40),plan=await get('SELECT * FROM shop_subscription_plans WHERE plan_key=? AND active=1',planKey);if(!plan) fail(404,'That subscription plan is unavailable.');
      if(planKey==='community') {
        const current=await get('SELECT provider,provider_subscription_id FROM shop_subscriptions WHERE shop_id=?',shopId);
        if(current?.provider_subscription_id) {
          if(!payments?.cancelShopSubscription) fail(503,'The payment provider cannot cancel this shop subscription yet.');
          try {await payments.cancelShopSubscription(current.provider_subscription_id);}catch(error){fail(error.status||503,error.message||'Subscription cancellation was not confirmed.');}
        }
        await run("UPDATE shop_subscriptions SET plan_key='community',status='active',provider=NULL,provider_subscription_id=NULL,current_period_end=NULL,checkout_url=NULL,updated_at=? WHERE shop_id=?",new Date().toISOString(),shopId);
        const eventTime=new Date().toISOString();
        await run('INSERT INTO shop_subscription_events(id,shop_id,event_type,plan_key,occurred_at,metadata) VALUES(?,?,\'plan_selected\',?,?,?)',randomUUID(),shopId,planKey,eventTime,JSON.stringify({cancelledSubscriptionId:current?.provider_subscription_id||null}));
        return {ok:true,planKey,status:'active'};
      }
      if(!payments?.createShopSubscription) fail(503,'Paid plans require Razorpay TEST credentials and a TEST subscription plan. No charge was made.');
      const current=await get('SELECT plan_key,status,checkout_url FROM shop_subscriptions WHERE shop_id=?',shopId);
      if(current?.plan_key===planKey&&current.status==='active') return {ok:true,planKey,status:'active'};
      if(current?.plan_key===planKey&&current.status==='pending_auth'&&current.checkout_url) return {ok:true,planKey,status:'pending_auth',checkoutUrl:current.checkout_url};
      if(current?.status==='active'&&current.plan_key!=='community') fail(409,'Cancel the current paid plan before starting another subscription.');
      if(current?.status==='pending_auth') fail(409,'A shop subscription checkout is already waiting for confirmation.');
      let providerSubscription;
      try {providerSubscription=await payments.createShopSubscription({shopId,planKey,expectedAmountMinor:Number(plan.price_minor)});}
      catch(error) {fail(error.status||503,error.message||'Could not start subscription checkout.');}
      if(!providerSubscription?.id||!providerSubscription?.short_url) fail(503,'Payment provider did not return a subscription checkout link.');
      const now=new Date().toISOString();
      await run("UPDATE shop_subscriptions SET plan_key=?,status='pending_auth',provider='razorpay',provider_subscription_id=?,checkout_url=?,updated_at=? WHERE shop_id=?",planKey,providerSubscription.id,providerSubscription.short_url,now,shopId);
      await run('INSERT INTO shop_subscription_events(id,shop_id,event_type,plan_key,occurred_at,metadata) VALUES(?,?,\'checkout_created\',?,?,?)',randomUUID(),shopId,planKey,now,JSON.stringify({providerSubscriptionId:providerSubscription.id}));
      return {ok:true,planKey,status:'pending_auth',checkoutUrl:providerSubscription.short_url};
    }
    fail(404,'Shop action unavailable.');
  }
  if(path==='/admin/shops'&&method==='GET') {if(!admin) fail(403,'Admin access is required.');return await all("SELECT b.id,b.name,b.business_type,b.verification_status,b.registration_reference,b.submitted_at,b.decision_reason,u.name AS owner_name,u.email AS owner_email FROM business_accounts b JOIN users u ON u.id=b.owner_user_id ORDER BY CASE b.verification_status WHEN 'pending' THEN 0 ELSE 1 END,b.created_at DESC LIMIT 200");}
  const shopReview=path.match(/^\/admin\/shops\/([a-f0-9-]{36})\/verification$/i);
  if(shopReview&&method==='PATCH') {if(!admin) fail(403,'Admin access is required.');const body=await json(req);if(!['verified','suspended','unverified'].includes(body.status)) fail(400,'Choose a valid business decision.');const row=await get('SELECT verification_status FROM business_accounts WHERE id=?',shopReview[1]);if(!row) fail(404,'Shop unavailable.');const now=new Date().toISOString(),reason=field(body,'reason',500,false);await query.transaction(async tx=>{await tx('UPDATE business_accounts SET verification_status=?,decision_reason=?,reviewed_at=?,reviewer_user_id=? WHERE id=?',body.status,reason,now,user.id,shopReview[1]);await tx('INSERT INTO business_verification_audit(shop_id,actor_user_id,old_status,new_status,reason,occurred_at) VALUES(?,?,?,?,?,?)',shopReview[1],user.id,row.verification_status,body.status,reason,now);});return {ok:true,status:body.status};}
  const shopDocument=path.match(/^\/admin\/shops\/([a-f0-9-]{36})\/document$/i);
  if(shopDocument&&method==='GET') {if(!admin) fail(403,'Admin access is required.');const row=await get('SELECT verification_document_key,verification_document_type FROM business_accounts WHERE id=?',shopDocument[1]);if(!row?.verification_document_key) fail(404,'Business document unavailable.');const stored=await storage.get(row.verification_document_key);if(!stored) fail(404,'Business document unavailable.');let bytes;try{bytes=kyc.decrypt(stored.bytes);}catch{fail(500,'Business document cannot be decrypted.');}await run('INSERT INTO business_document_access_audit(shop_id,reviewer_user_id,accessed_at) VALUES(?,?,?)',shopDocument[1],user.id,new Date().toISOString());return {binary:true,bytes,contentType:row.verification_document_type};}
  if (method === 'POST' && path === '/phone-otp/send') {
    throttle(req.socket.remoteAddress);
    const profile=await get('SELECT phone,phone_verified_at FROM users WHERE id=?',user.id);
    if (!profile?.phone || !/^\+?[1-9]\d{7,14}$/.test(profile.phone)) fail(400,'Save a valid phone number before requesting a code.');
    if (profile.phone_verified_at) return {ok:true,verified:true};
    const recent=await get("SELECT COUNT(*) AS count FROM phone_otp_challenges WHERE user_id=? AND created_at>?",user.id,new Date(Date.now()-3600000).toISOString());
    const localPhoneCode=process.env.NODE_ENV==='development'&&process.env.SMS_PROVIDER==='mock'&&process.env.ALLOW_DEV_OTP==='1';
    if (!localPhoneCode && Number(recent.count)>=3) fail(429,'You have requested several codes. Try again in an hour.');
    const code=localPhoneCode&&/^\d{6}$/.test(process.env.PHONE_OTP_DEV_CODE||'')?process.env.PHONE_OTP_DEV_CODE:String(randomInt(0,1000000)).padStart(6,'0');
    const id=randomUUID(),now=new Date(),expires=new Date(now.getTime()+10*60*1000).toISOString();
    await run('UPDATE phone_otp_challenges SET used_at=? WHERE user_id=? AND used_at IS NULL',now.toISOString(),user.id);
    await run('INSERT INTO phone_otp_challenges(id,user_id,phone,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)',id,user.id,profile.phone,digest(id+':'+code),expires,now.toISOString());
    try {
      const delivery=await sendSms({to:profile.phone,code,body:`Your NeighbourLink verification code is ${code}. It expires in 10 minutes.`});
      return {ok:true,devCode:delivery.devCode};
    } catch(error) {
      await run('UPDATE phone_otp_challenges SET used_at=? WHERE id=?',new Date().toISOString(),id);
      fail(503,error.message || 'Could not send a verification code. Try again later.');
    }
  }
  if (method === 'POST' && path === '/phone-otp/verify') {
    const code=field(await json(req),'code',6);
    if (!/^\d{6}$/.test(code)) fail(400,'Enter the six-digit code.');
    const now=new Date().toISOString();
    const challenge=await get('SELECT id,phone,code_hash,attempts FROM phone_otp_challenges WHERE user_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1',user.id,now);
    if (!challenge || challenge.attempts>=5) fail(400,'That code is invalid or expired. Request a new one.');
    if (digest(challenge.id+':'+code)!==challenge.code_hash) {
      await run('UPDATE phone_otp_challenges SET attempts=attempts+1 WHERE id=? AND used_at IS NULL AND attempts<5',challenge.id);
      fail(400,'That code is incorrect. Check it and try again.');
    }
    await query.transaction(async tx=>{
      const used=await tx('UPDATE phone_otp_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5',now,challenge.id,now);
      if (!used.changes) fail(400,'That code is invalid or expired. Request a new one.');
      const verified=await tx('UPDATE users SET phone_verified_at=? WHERE id=? AND phone=?',now,user.id,challenge.phone);
      if (!verified.changes) fail(409,'The phone number changed. Request a fresh code for the saved number.');
    });
    return {ok:true,verified:true};
  }
  if (!user.profileComplete && !['/profile','/uploads','/phone-otp/send','/phone-otp/verify','/logout'].includes(path)) fail(403,'Complete your profile and verify your phone to continue.');
  if (method === 'POST' && path === '/uploads') {
    throttle('uploads:' + req.socket.remoteAddress,60);
    const purpose=req.headers['x-upload-purpose'];
    if (!['profile','listing','kyc-id','kyc-selfie','business-doc','booking-handover','booking-return','booking-claim'].includes(purpose)) fail(400,'Choose a valid image purpose.');
    if (purpose === 'listing' && !user.profileComplete) fail(403,'Complete your profile before listing items.');
    if (purpose.startsWith('kyc-') && !user.profileComplete) fail(403,'Verify your phone and finish your profile before identity verification.');
    if (purpose==='business-doc'&&!user.profileComplete) fail(403,'Complete your profile before verifying a shop.');
    if (purpose.startsWith('booking-') && !user.profileComplete) fail(403,'Complete your profile before adding booking evidence.');
    const {bytes,contentType,image}=await readImageRequest(req);
    const id=randomUUID();
    const storageKey=(purpose.startsWith('booking-')?'evidence/':purpose==='business-doc'?'business/'+user.id+'/':'users/'+user.id+'/') + purpose + '/' + id + '.' + image.extension;
    const encrypted=purpose.startsWith('kyc-')||purpose==='business-doc';
    await storage.put(storageKey,encrypted ? kyc.encrypt(bytes) : bytes,encrypted ? 'application/octet-stream' : contentType);
    try {
      await run('INSERT INTO uploads(id,user_id,purpose,storage_key,content_type,byte_size,created_at) VALUES(?,?,?,?,?,?,?)',id,user.id,purpose,storageKey,contentType,bytes.length,new Date().toISOString());
    } catch(error) { await storage.remove(storageKey).catch(() => {}); throw error; }
    return {uploadId:id};
  }
  if (method === 'GET' && path === '/profile') {
    const profile = await get('SELECT name,email,phone,profile_photo,profile_photo_key FROM users WHERE id=?',user.id);
    let photo=profile.profile_photo;
    if (profile.profile_photo_key) {
      const stored=await storage.get(profile.profile_photo_key);
      photo=stored ? 'data:' + stored.contentType + ';base64,' + stored.bytes.toString('base64') : null;
    }
    return {name:profile.name,email:profile.email,phone:profile.phone,photo,phoneVerified:Boolean(user.phoneVerifiedAt)};
  }
  if (method === 'PUT' && path === '/profile') {
    const body = await json(req);
    const name = field(body,'name',80);
    const phone = field(body,'phone',20).replace(/[\s()-]/g,'');
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) fail(400,'Enter a valid phone number with country code.');
    const current=await get('SELECT phone,profile_photo,profile_photo_key FROM users WHERE id=?',user.id);
    const uploadId=typeof body.photoUploadId==='string' ? body.photoUploadId : '';
    let upload=null;
    if (uploadId) upload=await get("SELECT storage_key FROM uploads WHERE id=? AND user_id=? AND purpose='profile' AND consumed_at IS NULL AND created_at>?",uploadId,user.id,new Date(Date.now()-3600000).toISOString());
    if (!upload && !current?.profile_photo && !current?.profile_photo_key) fail(400,'Upload a new profile photo before saving.');
    await query.transaction(async tx => {
      if (upload) {
        const used=await tx("UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND purpose='profile' AND consumed_at IS NULL",new Date().toISOString(),uploadId,user.id);
        if (!used.changes) fail(400,'That profile photo has already been used. Upload it again.');
      }
      await tx('UPDATE users SET name=?,phone=?,phone_verified_at=CASE WHEN phone=? THEN phone_verified_at ELSE NULL END,profile_photo=CASE WHEN ? IS NULL THEN profile_photo ELSE NULL END,profile_photo_key=COALESCE(?,profile_photo_key) WHERE id=?',name,phone,current.phone,upload?.storage_key || null,upload?.storage_key || null,user.id);
    });
    return {ok:true,phoneVerified:phone===current.phone && Boolean(user.phoneVerifiedAt)};
  }
  const calendar=path.match(/^\/listings\/(\d+)\/availability$/);
  if (calendar) {
    const listingId=Number(calendar[1]),item=await get('SELECT owner,kind FROM listings WHERE id=? AND active=1',listingId);
    if (!item) fail(404,'Listing unavailable.');
    if (item.kind!=='gear') fail(400,'Availability calendars are for Gear rentals.');
    if (method==='GET') {
      const blocks=await all('SELECT id,start_date,end_date,\'owner_block\' AS source FROM listing_availability_blocks WHERE listing=?',listingId);
      const bookings=await all("SELECT NULL AS id,start_date,end_date,'rental' AS source FROM requests WHERE listing=? AND is_gear=1 AND status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completed')",listingId);
      return [...blocks,...bookings].sort((a,b)=>a.start_date.localeCompare(b.start_date));
    }
    if (method==='POST') {
      if (item.owner!==user.id) fail(403,'Only the listing owner can block dates.');
      const body=await json(req),start=field(body,'startDate',10),end=field(body,'endDate',10),today=new Date().toISOString().slice(0,10);
      if (!validDate(start)||!validDate(end)||start<today||end<start||(Date.parse(end)-Date.parse(start))/86400000>90) fail(400,'Choose future dates for a block of up to 91 days.');
      if (await get("SELECT id FROM requests WHERE listing=? AND is_gear=1 AND status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completed') AND start_date<=? AND end_date>=?",listingId,end,start)) fail(409,'Those dates already have a rental booking.');
      if (await get('SELECT id FROM listing_availability_blocks WHERE listing=? AND start_date<=? AND end_date>=?',listingId,end,start)) fail(409,'That block overlaps dates you already blocked.');
      const id=randomUUID();await run('INSERT INTO listing_availability_blocks(id,listing,owner_user_id,start_date,end_date,created_at) VALUES(?,?,?,?,?,?)',id,listingId,user.id,start,end,new Date().toISOString());
      return {ok:true,id,start_date:start,end_date:end};
    }
  }
  const unblock=path.match(/^\/listings\/(\d+)\/availability\/([a-f0-9-]{36})$/i);
  if (unblock&&method==='DELETE') {
    const changed=await run('DELETE FROM listing_availability_blocks WHERE id=? AND listing=? AND owner_user_id=?',unblock[2],Number(unblock[1]),user.id);
    if (!changed.changes) fail(404,'Date block unavailable.');
    return {ok:true};
  }
  if (method === 'GET' && path === '/listings') {
    const params=new URL(req.url,'http://localhost').searchParams,kind=params.get('kind')||'',category=params.get('category')||'';
    if (kind&&!['gear','help'].includes(kind)) fail(400,'Choose the Gear or Hire portal.');
    const categoryOptions={gear:['Tools','Tech & Camera','Outdoors'],help:['Home repair','Creative','Lessons']};
    if (category&&kind&& !categoryOptions[kind].includes(category)) fail(400,'Choose a category from this portal.');
    const minPrice=params.has('minPrice')?Number(params.get('minPrice')):null,maxPrice=params.has('maxPrice')?Number(params.get('maxPrice')):null;
    if ((minPrice!=null&&(!Number.isSafeInteger(minPrice)||minPrice<0||minPrice>10000000))||(maxPrice!=null&&(!Number.isSafeInteger(maxPrice)||maxPrice<0||maxPrice>10000000))||(minPrice!=null&&maxPrice!=null&&minPrice>maxPrice)) fail(400,'Enter a valid rupee price range.');
    let minRating=params.has('minRating')?Number(params.get('minRating')):0;
    if (!Number.isFinite(minRating)||minRating<0||minRating>5) fail(400,'Rating filter must be between zero and five.');
    const latitude=params.has('latitude')?Number(params.get('latitude')):null,longitude=params.has('longitude')?Number(params.get('longitude')):null,radius=params.has('radius')?Number(params.get('radius')):null;
    if ((latitude==null)!==(longitude==null)||(latitude!=null&&(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180))) fail(400,'Enter a valid location.');
    if (radius!=null&&(!Number.isFinite(radius)||radius<0.1||radius>500||latitude==null)) fail(400,'Distance must be between 0.1 and 500 km and requires a location.');
    const startDate=params.get('startDate')||'',endDate=params.get('endDate')||'';
    if (Boolean(startDate)!==Boolean(endDate)) fail(400,'Choose both a start and end date.');
    if (startDate&&(!validDate(startDate)||!validDate(endDate)||endDate<startDate)) fail(400,'Choose a valid date range.');
    if (startDate&&kind==='gear') {
      const duration=Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1;
      if (duration>Number((await settingValues(['max_rental_days'])).max_rental_days||30)) fail(400,'The date range is longer than the allowed rental period.');
    }
    const sort=params.get('sort')||'newest';
    if (!['newest','nearest','price','rating'].includes(sort)) fail(400,'Choose a valid sort order.');
    const conditions=['l.active=1'],args=[];
    if (kind) {conditions.push('l.kind=?');args.push(kind);}
    if (category) {conditions.push('l.category=?');args.push(category);}
    if (minPrice!=null) {conditions.push('l.price>=?');args.push(minPrice);}
    if (maxPrice!=null) {conditions.push('l.price<=?');args.push(maxPrice);}
    if (startDate&&kind==='gear') {
      conditions.push("NOT EXISTS (SELECT 1 FROM listing_availability_blocks b WHERE b.listing=l.id AND b.start_date<=? AND b.end_date>=?)");args.push(endDate,startDate);
      conditions.push("(SELECT COUNT(*) FROM requests rr WHERE rr.listing=l.id AND rr.is_gear=1 AND rr.status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completed') AND rr.start_date<=? AND rr.end_date>=?) < l.quantity_available");args.push(endDate,startDate);
    }
    if (startDate&&kind==='help') {
      conditions.push("(SELECT COUNT(*) FROM requests rr WHERE rr.listing=l.id AND rr.status IN ('accepted','completion_proposed') AND rr.start_date<=? AND rr.end_date>=?) < l.quantity_available");args.push(endDate,startDate);
    }
    let rows=await all(listings+' WHERE '+conditions.join(' AND ')+' ORDER BY l.id DESC LIMIT 500',...args);
    rows=rows.map(row=>{
      const gearCount=Number(row.gear_rating_count||0),hireCount=Number(row.hire_rating_count||0),ratingCount=gearCount+hireCount;
      const rating=ratingCount?(Number(row.gear_rating||0)*gearCount+Number(row.hire_rating||0)*hireCount)/ratingCount:null;
      const distance=latitude==null||row.latitude==null||row.longitude==null?null:distanceKm(latitude,longitude,row.latitude,row.longitude);
      const result={...row,owner_rating:rating==null?null:Number(rating.toFixed(2)),rating_count:ratingCount,distance_km:distance==null?null:Number(distance.toFixed(2))};
      delete result.gear_rating;delete result.gear_rating_count;delete result.hire_rating;delete result.hire_rating_count;
      return result;
    });
    if (minRating>0) rows=rows.filter(row=>row.owner_rating!=null&&row.owner_rating>=minRating);
    if (radius!=null) rows=rows.filter(row=>row.distance_km!=null&&row.distance_km<=radius);
    if (sort==='nearest') rows.sort((a,b)=>(a.distance_km??Infinity)-(b.distance_km??Infinity)||b.id-a.id);
    if (sort==='price') rows.sort((a,b)=>a.price-b.price||b.id-a.id);
    if (sort==='rating') rows.sort((a,b)=>(b.owner_rating??-1)-(a.owner_rating??-1)||b.id-a.id);
    return rows;
  }
  if (method === 'POST' && path === '/logout') {
    await run('DELETE FROM sessions WHERE token=?', digest(token));
    cookie(res, '', 0);
    return { ok: true };
  }
  if (method === 'GET' && path === '/kyc/status') {
    const row=await get('SELECT status,submitted_at,reviewed_at,decision_reason FROM kyc_cases WHERE user_id=?',user.id);
    return row || {status:'unverified',submitted_at:null,reviewed_at:null,decision_reason:null};
  }
  if (method === 'POST' && path === '/kyc/submit') {
    const body=await json(req);
    const idUploadId=field(body,'idUploadId',36),selfieUploadId=field(body,'selfieUploadId',36);
    if (idUploadId===selfieUploadId) fail(400,'Upload an ID image and a separate selfie.');
    const uploads=await all("SELECT id,purpose,storage_key,content_type FROM uploads WHERE id IN (?,?) AND user_id=? AND consumed_at IS NULL AND created_at>?",idUploadId,selfieUploadId,user.id,new Date(Date.now()-3600000).toISOString());
    const idDocument=uploads.find(row=>row.id===idUploadId&&row.purpose==='kyc-id');
    const selfie=uploads.find(row=>row.id===selfieUploadId&&row.purpose==='kyc-selfie');
    if (!idDocument || !selfie) fail(400,'Upload a government ID image and a face selfie before submitting.');
    const previous=await get('SELECT status,id_storage_key,selfie_storage_key FROM kyc_cases WHERE user_id=?',user.id);
    const now=new Date().toISOString();
    await query.transaction(async tx=>{
      for (const uploadId of [idUploadId,selfieUploadId]) {
        const consumed=await tx('UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND consumed_at IS NULL',now,uploadId,user.id);
        if (!consumed.changes) fail(400,'An identity image has already been used. Upload it again.');
      }
      await tx("INSERT INTO kyc_cases(user_id,status,id_storage_key,id_content_type,selfie_storage_key,selfie_content_type,provider,submitted_at,reviewed_at,reviewer_user_id,decision_reason) VALUES(?,'unverified',?,?,?,?,?,?,NULL,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET status='unverified',id_storage_key=excluded.id_storage_key,id_content_type=excluded.id_content_type,selfie_storage_key=excluded.selfie_storage_key,selfie_content_type=excluded.selfie_content_type,provider=excluded.provider,submitted_at=excluded.submitted_at,reviewed_at=NULL,reviewer_user_id=NULL,decision_reason=NULL",user.id,idDocument.storage_key,idDocument.content_type,selfie.storage_key,selfie.content_type,kyc.provider,now);
      await tx("UPDATE users SET kyc_status='unverified' WHERE id=?",user.id);
      if (previous) await tx('INSERT INTO kyc_review_audit(actor_user_id,subject_user_id,old_status,new_status,reason,occurred_at) VALUES(?,?,?,?,?,?)',user.id,user.id,previous.status,'unverified','Documents resubmitted by account holder.',now);
    });
    for (const key of [previous?.id_storage_key,previous?.selfie_storage_key]) if (key) await storage.remove(key).catch(()=>{});
    return {ok:true,status:'unverified'};
  }
  if (admin && method === 'GET' && path === '/admin/kyc') {
    return await all('SELECT c.user_id,c.status,c.submitted_at,c.reviewed_at,c.decision_reason,u.name,u.email FROM kyc_cases c JOIN users u ON u.id=c.user_id ORDER BY c.submitted_at DESC');
  }
  const kycDoc=path.match(/^\/admin\/kyc\/(\d+)\/documents\/(id|selfie)$/);
  if (kycDoc && method === 'GET') {
    if (!admin) fail(403,'Admin access is required.');
    const subject=Number(kycDoc[1]),kind=kycDoc[2];
    const row=await get('SELECT id_storage_key,id_content_type,selfie_storage_key,selfie_content_type FROM kyc_cases WHERE user_id=?',subject);
    const key=kind==='id'?row?.id_storage_key:row?.selfie_storage_key;
    const contentType=kind==='id'?row?.id_content_type:row?.selfie_content_type;
    if (!key) fail(404,'Identity document unavailable.');
    const stored=await storage.get(key);
    if (!stored) fail(404,'Identity document unavailable.');
    let bytes;
    try { bytes=kyc.decrypt(stored.bytes); } catch { fail(500,'Identity document cannot be decrypted.'); }
    await run('INSERT INTO kyc_access_audit(reviewer_user_id,subject_user_id,document_kind,accessed_at) VALUES(?,?,?,?)',user.id,subject,kind,new Date().toISOString());
    return {binary:true,bytes,contentType};
  }
  const kycReview=path.match(/^\/admin\/kyc\/(\d+)\/status$/);
  if (kycReview && method === 'PATCH') {
    if (!admin) fail(403,'Admin access is required.');
    const subject=Number(kycReview[1]),body=await json(req);
    try { kyc.normalizeDecision(body.status); } catch { fail(400,'Choose a valid KYC decision.'); }
    const row=await get('SELECT status FROM kyc_cases WHERE user_id=?',subject);
    if (!row) fail(404,'KYC submission unavailable.');
    if (row.status===body.status) return {ok:true,status:row.status};
    const reason=field(body,'reason',500,false),now=new Date().toISOString();
    await query.transaction(async tx=>{
      await tx('UPDATE kyc_cases SET status=?,decision_reason=?,reviewed_at=?,reviewer_user_id=? WHERE user_id=?',body.status,reason,now,user.id,subject);
      await tx('UPDATE users SET kyc_status=? WHERE id=?',body.status,subject);
      await tx('INSERT INTO kyc_review_audit(actor_user_id,subject_user_id,old_status,new_status,reason,occurred_at) VALUES(?,?,?,?,?,?)',user.id,subject,row.status,body.status,reason,now);
    });
    return {ok:true,status:body.status};
  }
  if (path==='/admin/dashboard'&&method==='GET') {
    if (!admin) fail(403,'Admin access is required.');
    const [users,listings,bookings,claims,financial]=await Promise.all([
      get("SELECT COUNT(*) AS total,COUNT(CASE WHEN email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL THEN 1 END) AS verified,COUNT(CASE WHEN kyc_status='suspended' THEN 1 END) AS suspended FROM users"),
      get('SELECT COUNT(*) AS total,COUNT(CASE WHEN active=1 THEN 1 END) AS active FROM listings'),
      get("SELECT COUNT(*) AS captured,COUNT(CASE WHEN r.status='completed' THEN 1 END) AS completed,COUNT(CASE WHEN r.status IN ('disputed','resolved') THEN 1 END) AS claims FROM requests r JOIN protected_payments p ON p.booking=r.id WHERE p.payment_status='captured'"),
      get("SELECT COUNT(*) AS open FROM booking_claims WHERE status IN ('open','resolving')"),
      get("SELECT COALESCE(SUM(CASE WHEN event_type IN ('commission','subscription_charge') THEN amount_minor ELSE 0 END),0) AS revenue,COALESCE(SUM(CASE WHEN event_type='claim_deduction' THEN amount_minor ELSE 0 END),0) AS claim_deductions,COALESCE(SUM(CASE WHEN event_type='capture' THEN amount_minor ELSE 0 END),0) AS captured_minor FROM money_ledger")
    ]);
    const repeat=await get("SELECT COUNT(*) AS repeat_users,(SELECT COUNT(DISTINCT requester) FROM requests WHERE status IN ('completed','resolved')) AS completed_users FROM (SELECT requester FROM requests WHERE status IN ('completed','resolved') GROUP BY requester HAVING COUNT(*)>=2) repeat_renters");
    const completed=Number(bookings.completed||0),captured=Number(bookings.captured||0);
    const completedUsers=Number(repeat.completed_users||0),capturedMinor=Number(financial.captured_minor||0);
    return {users:{total:Number(users.total||0),verified:Number(users.verified||0),suspended:Number(users.suspended||0)},listings:{total:Number(listings.total||0),active:Number(listings.active||0)},rentals:{captured,completed,repeatRenters:Number(repeat.repeat_users||0),repeatRate:completedUsers?Number(repeat.repeat_users||0)/completedUsers:0},disputes:{open:Number(claims.open||0),total:Number(bookings.claims||0),rate:captured?Number(bookings.claims||0)/captured:0,lossRate:capturedMinor?Number(financial.claim_deductions||0)/capturedMinor:0},revenueMinor:Number(financial.revenue||0)};
  }
  if (path==='/admin/users'&&method==='GET') {
    if (!admin) fail(403,'Admin access is required.');
    return await all(`SELECT u.id,u.name,u.email,u.phone,u.email_verified_at,u.phone_verified_at,u.kyc_status,
      (SELECT COUNT(*) FROM requests r WHERE r.requester=u.id AND r.status IN ('completed','resolved')) AS completed_rentals,
      (SELECT COUNT(*) FROM listings l WHERE l.owner=u.id AND l.active=1) AS active_listings
      FROM users u ORDER BY u.id DESC LIMIT 200`);
  }
  if (path==='/admin/listings'&&method==='GET') {
    if (!admin) fail(403,'Admin access is required.');
    return await all('SELECT l.id,l.owner,l.kind,l.title,l.category,l.price,l.area,l.active,u.name AS owner_name,u.email AS owner_email FROM listings l JOIN users u ON u.id=l.owner ORDER BY l.id DESC LIMIT 200');
  }
  if (path==='/admin/ledger'&&method==='GET') {
    if (!admin) fail(403,'Admin access is required.');
    const limit=Math.max(1,Math.min(100,Number(new URL(req.url,'http://localhost').searchParams.get('limit'))||50));
    return await all(`SELECT m.id,m.booking,m.event_type,m.amount_minor,m.currency,m.provider,m.provider_reference,m.idempotency_key,m.metadata,m.occurred_at,u.name AS actor_name
      FROM money_ledger m LEFT JOIN users u ON u.id=m.actor_user_id ORDER BY m.id DESC LIMIT ?`,limit);
  }
  if (path==='/admin/claims'&&method==='GET') {
    if (!admin) fail(403,'Admin access is required.');
    const rows=await all(`SELECT c.booking,c.owner_user_id,c.reason,c.status AS claim_status,c.renter_response,c.created_at,c.responded_at,c.resolved_at,c.resolution,c.resolution_reason,c.deduction_minor,
      r.status,r.requester,r.start_date,r.end_date,r.deposit_minor,l.title,l.category,l.condition_checklist,l.price,
      owner.name AS owner_name,owner.email AS owner_email,renter.name AS renter_name,renter.email AS renter_email,p.payment_status,p.amount_minor
      FROM booking_claims c JOIN requests r ON r.id=c.booking JOIN listings l ON l.id=r.listing
      JOIN users owner ON owner.id=c.owner_user_id JOIN users renter ON renter.id=r.requester
      LEFT JOIN protected_payments p ON p.booking=r.id ORDER BY CASE WHEN c.status='open' THEN 0 WHEN c.status='resolving' THEN 1 ELSE 2 END,c.created_at DESC LIMIT 100`);
    return await Promise.all(rows.map(async row=>({...row,
      evidence:await all('SELECT e.id,e.phase,e.uploader_user_id,e.uploaded_at,u.name FROM booking_evidence e JOIN users u ON u.id=e.uploader_user_id WHERE e.booking=? ORDER BY e.uploaded_at',row.booking),
      messages:await all('SELECT m.body,m.sent,u.name FROM messages m JOIN users u ON u.id=m.sender WHERE m.request=? ORDER BY m.id LIMIT 200',row.booking),
      claimEvidence:await all('SELECT e.id,e.uploader_user_id,e.uploaded_at,u.name FROM booking_claim_evidence e JOIN users u ON u.id=e.uploader_user_id WHERE e.booking=? ORDER BY e.uploaded_at',row.booking),
      statusHistory:await all('SELECT old_status,new_status,occurred_at,actor_user_id FROM booking_status_audit WHERE booking=? ORDER BY id',row.booking),
      claimHistory:await all('SELECT event_type,event_data,occurred_at,actor_user_id FROM booking_claim_audit WHERE booking=? ORDER BY id',row.booking)
    })));
  }
  if (path==='/seller/dashboard'&&method==='GET') {
    const [released,listingsCount,bookingCount,held]=await Promise.all([
      get("SELECT COALESCE(SUM(CASE WHEN m.event_type IN ('payout','late_fee_payout') THEN m.amount_minor ELSE 0 END),0) AS amount FROM money_ledger m JOIN requests r ON r.id=m.booking JOIN listings l ON l.id=r.listing WHERE l.owner=? OR l.shop_id IN (SELECT shop_id FROM business_members WHERE user_id=?)",user.id,user.id),
      get('SELECT COUNT(*) AS total,COUNT(CASE WHEN active=1 THEN 1 END) AS active FROM listings l WHERE l.owner=? OR l.shop_id IN (SELECT shop_id FROM business_members WHERE user_id=?)',user.id,user.id),
      get("SELECT COUNT(*) AS total,COUNT(CASE WHEN status IN ('completed','resolved') THEN 1 END) AS completed FROM requests r JOIN listings l ON l.id=r.listing WHERE l.owner=? OR l.shop_id IN (SELECT shop_id FROM business_members WHERE user_id=?)",user.id,user.id),
      all("SELECT r.id,r.status,r.start_date,r.end_date,r.due_at,r.claim_deadline,r.deposit_minor,p.rent_minor,p.commission_minor,p.deposit_minor AS held_deposit,l.title FROM requests r JOIN listings l ON l.id=r.listing JOIN protected_payments p ON p.booking=r.id WHERE (l.owner=? OR l.shop_id IN (SELECT shop_id FROM business_members WHERE user_id=?)) AND p.payment_status='captured' AND p.settlement_status='open' ORDER BY COALESCE(r.claim_deadline,r.due_at),r.id LIMIT 50",user.id,user.id)
    ]);
    const windowHours=Number((await settingValues(['claim_window_hours'])).claim_window_hours||24);
    const upcoming=held.map(row=>{
      const deadline=row.claim_deadline|| (row.due_at?new Date(Date.parse(row.due_at)+windowHours*3600000).toISOString():null);
      return {booking:row.id,title:row.title,status:row.status,estimated_release_at:deadline,rental_release_minor:Number(row.rent_minor)-Number(row.commission_minor),refundable_deposit_minor:Number(row.held_deposit||row.deposit_minor||0)};
    });
    return {listings:{total:Number(listingsCount.total||0),active:Number(listingsCount.active||0)},bookings:{total:Number(bookingCount.total||0),completed:Number(bookingCount.completed||0)},releasedThroughProviderMinor:Number(released.amount||0),heldWithProvider:{rentalMinor:upcoming.reduce((sum,row)=>sum+row.rental_release_minor,0),refundableDepositMinor:upcoming.reduce((sum,row)=>sum+row.refundable_deposit_minor,0)},upcoming};
  }
  const resolveClaim=path.match(/^\/admin\/claims\/(\d+)\/resolve$/);
  if (resolveClaim&&method==='POST') {
    if (!admin) fail(403,'Admin access is required.');
    const bookingId=Number(resolveClaim[1]),body=await json(req),decision=body.decision;
    if (!['full_refund','partial_deduction','full_capture'].includes(decision)) fail(400,'Choose a supported deposit decision.');
    const claim=await get('SELECT * FROM booking_claims WHERE booking=?',bookingId);
    const payment=await get('SELECT * FROM protected_payments WHERE booking=?',bookingId);
    if (!claim||!payment||payment.payment_status!=='captured') fail(404,'A paid claim is unavailable.');
    if (!payments||!payment.provider_payment_id||!payment.deposit_transfer_id||!payment.rental_transfer_id) fail(503,'Payment settlement is unavailable or incomplete. Reconcile with the provider before deciding.');
    let deduction=decision==='full_refund'?0:decision==='full_capture'?Number(payment.deposit_minor):body.deductionMinor;
    if (!Number.isSafeInteger(deduction)||deduction<0||deduction>Number(payment.deposit_minor)||(decision==='partial_deduction'&&(deduction<1||deduction>=Number(payment.deposit_minor)))) fail(400,'The deduction must be a whole-paise amount within the refundable deposit.');
    const reason=field(body,'reason',800,false),now=new Date().toISOString();
    if (claim.status==='resolved') fail(409,'This claim has already been resolved.');
    if (claim.status==='resolving'&&(claim.resolution!==decision||Number(claim.deduction_minor)!==deduction||claim.resolution_reason!==reason)) fail(409,'Retry the saved claim decision with the same choice and note.');
    if (!['open','resolving'].includes(claim.status)||!(await get("SELECT id FROM requests WHERE id=? AND status='disputed'",bookingId))) fail(409,'This booking is not waiting for a claim decision.');
    const settlement=await run("UPDATE protected_payments SET settlement_status='claim_resolving',settlement_started_at=?,updated_at=? WHERE booking=? AND (settlement_status='open' OR (settlement_status='claim_resolving' AND settlement_started_at<?))",now,now,bookingId,new Date(Date.now()-300000).toISOString());
    if (!settlement.changes) fail(409,'Another claim settlement is in progress. Refresh before retrying.');
    try {
      if (claim.status==='open') {
        await query.transaction(async tx=>{
          const saved=await tx("UPDATE booking_claims SET status='resolving',resolution=?,resolution_reason=?,deduction_minor=?,resolver_user_id=? WHERE booking=? AND status='open'",decision,reason,deduction,user.id,bookingId);
          if (!saved.changes) fail(409,'The claim changed. Refresh and review it again.');
          await tx('INSERT INTO booking_claim_audit(booking,actor_user_id,event_type,event_data,occurred_at) VALUES(?,?,?,?,?)',bookingId,user.id,'resolution_started',JSON.stringify({decision,deductionMinor:deduction,reason}),now);
        });
      }
      const renterRefund=Number(payment.deposit_minor)-deduction;
      const reverseTransfer=async(transferId,target)=>{
        if (!target) return;
        const transfer=await payments.fetchTransfer(transferId);
        if (!transfer) fail(503,'A held transfer cannot be verified. Reconciliation is required.');
        const reversed=Number(transfer.amount_reversed||0);
        if (reversed>target) fail(503,'The held deposit has already been reversed beyond this saved decision. Reconcile with Razorpay.');
        if (reversed<target) await payments.reverseTransfer(transferId,target-reversed);
      };
      await reverseTransfer(payment.deposit_transfer_id,renterRefund);
      const releasedDeposit=Number(payment.deposit_minor)-renterRefund;
      if (releasedDeposit>0) await payments.setHold(payment.deposit_transfer_id,false);
      if (Number(payment.rent_minor)-Number(payment.commission_minor)>0) await payments.setHold(payment.rental_transfer_id,false);
      if (renterRefund>0) {
        const providerPayment=await payments.findPayment(payment.provider_payment_id);
        const alreadyRefunded=Number(providerPayment?.amount_refunded||0);
        if (alreadyRefunded>renterRefund) fail(503,'The renter has already received more than the saved deposit refund. Reconcile with Razorpay.');
        if (alreadyRefunded<renterRefund) await payments.refund(payment.provider_payment_id,renterRefund-alreadyRefunded);
      }
      const finishedAt=new Date().toISOString();
      await query.transaction(async tx=>{
        const changed=await tx("UPDATE requests SET status='resolved' WHERE id=? AND status='disputed'",bookingId);
        if (!changed.changes) fail(409,'The booking changed before the decision could be recorded.');
        const claimUpdate=await tx("UPDATE booking_claims SET status='resolved',resolved_at=? WHERE booking=? AND status='resolving'",finishedAt,bookingId);
        if (!claimUpdate.changes) fail(409,'The claim resolution record changed.');
        await tx("UPDATE protected_payments SET settlement_status='resolved',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='claim_resolving'",finishedAt,bookingId);
        await tx("INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,'disputed','resolved',?,?)",bookingId,user.id,finishedAt,JSON.stringify({decision,deductionMinor:deduction}));
        await tx('INSERT INTO booking_claim_audit(booking,actor_user_id,event_type,event_data,occurred_at) VALUES(?,?,?,?,?)',bookingId,user.id,'resolved',JSON.stringify({decision,deductionMinor:deduction,reason}),finishedAt);
        const events=[
          ['transfer_reversal',renterRefund,payment.deposit_transfer_id,'claim-deposit-reversal'],
          ['payout',releasedDeposit,payment.deposit_transfer_id,'claim-deposit-payout'],
          ['claim_deduction',deduction,payment.deposit_transfer_id,'claim-deduction'],
          ['release',Number(payment.rent_minor)-Number(payment.commission_minor),payment.rental_transfer_id,'claim-rent-release'],
          ['payout',Number(payment.rent_minor)-Number(payment.commission_minor),payment.rental_transfer_id,'claim-rent-payout'],
          ['refund',renterRefund,payment.provider_payment_id,'claim-deposit-refund']
        ];
        for (const [kind,amount,reference,key] of events) if (amount>0) await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,actor_user_id,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)',bookingId,kind,amount,'INR','razorpay',reference,'booking:'+bookingId+':'+key,user.id,JSON.stringify({decision}),finishedAt);
      });
      return {ok:true,status:'resolved',decision,deductionMinor:deduction,refundedMinor:renterRefund};
    } catch(error) {
      await run("UPDATE protected_payments SET settlement_status='open',settlement_started_at=NULL,updated_at=? WHERE booking=? AND settlement_status='claim_resolving'",new Date().toISOString(),bookingId).catch(()=>{});
      throw error;
    }
  }
  if (method === 'GET' && path === '/activity') {
    const unread=await all('SELECT request,COUNT(*) AS count FROM messages WHERE sender<>? AND read_at IS NULL GROUP BY request',user.id);
    const counts=new Map(unread.map(row=>[row.request,Number(row.count)]));
    return {
    listings: await all(listings + ' WHERE l.owner=? OR l.shop_id IN (SELECT shop_id FROM business_members WHERE user_id=?) ORDER BY l.id DESC', user.id,user.id),
    saved: (await all('SELECT listing FROM saved WHERE "user"=?', user.id)).map(row => row.listing),
    threads: (await all(threads + ' WHERE r.requester=? OR l.owner=? ORDER BY r.id DESC', user.id, user.id)).map(row=>({...row,score:user.id===row.requester?row.requester_score:row.owner_score,otherScore:user.id===row.requester?row.owner_score:row.requester_score,unread_count:counts.get(row.id)||0})),
    reports: admin ? await all('SELECT reports.*,listings.title FROM reports JOIN listings ON listings.id=reports.listing WHERE reports.status=?', 'open') : []
  };}
  const evidenceFile=path.match(/^\/requests\/(\d+)\/evidence\/([a-f0-9-]{36})$/i);
  if (method==='GET'&&evidenceFile) {
    const booking=Number(evidenceFile[1]);
    if (!admin&&!await get(threads+' WHERE r.id=? AND (r.requester=? OR l.owner=?)',booking,user.id,user.id)) fail(404,'Evidence unavailable.');
    const evidence=await get('SELECT storage_key,content_type FROM booking_evidence WHERE id=? AND booking=?',evidenceFile[2],booking);
    if (!evidence) fail(404,'Evidence unavailable.');
    const photo=await storage.get(evidence.storage_key);
    if (!photo) fail(404,'Evidence unavailable.');
    return {binary:true,bytes:photo.bytes,contentType:evidence.content_type};
  }
  const claimEvidenceFile=path.match(/^\/requests\/(\d+)\/claim-evidence\/([a-f0-9-]{36})$/i);
  if (method==='GET'&&claimEvidenceFile) {
    const booking=Number(claimEvidenceFile[1]);
    if (!admin&&!await get(threads+' WHERE r.id=? AND (r.requester=? OR l.owner=?)',booking,user.id,user.id)) fail(404,'Claim photo unavailable.');
    const evidence=await get('SELECT storage_key,content_type FROM booking_claim_evidence WHERE id=? AND booking=?',claimEvidenceFile[2],booking);
    if (!evidence) fail(404,'Claim photo unavailable.');
    const photo=await storage.get(evidence.storage_key);
    if (!photo) fail(404,'Claim photo unavailable.');
    return {binary:true,bytes:photo.bytes,contentType:evidence.content_type};
  }
  if (method==='GET'&&path==='/payment-account') return await get('SELECT account_id FROM owner_payment_accounts WHERE user_id=? AND provider=?',user.id,'razorpay')||{account_id:null};
  if (method==='PUT'&&path==='/payment-account') {
    if (!payments) fail(503,'Protected payments are not configured yet.');
    const accountId=field(await json(req),'accountId',40);
    const account=await payments.verifyLinkedAccount(accountId);
    if (!account) fail(400,'Connect an activated Razorpay Route linked account.');
    const now=new Date().toISOString();
    await run('INSERT INTO owner_payment_accounts(user_id,provider,account_id,verified_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,account_id=excluded.account_id,verified_at=excluded.verified_at',user.id,'razorpay',accountId,now,now);
    return {ok:true,connected:true};
  }
  const match = path.match(/^\/(listings|saved|requests|reports)\/(\d+)(?:\/(messages|rating|checkout|audit|evidence|claim|contact|quote)|\/checkout\/verify)?$/);
  const id = match && Number(match[2]);
  if (match?.[1]==='listings'&&match[3]==='quote'&&method==='GET') {
    const listing=await get('SELECT owner,kind,category,item_value_minor,deposit_override_minor,price FROM listings WHERE id=? AND active=1',id);
    if (!listing) fail(404,'Listing unavailable.');
    if (listing.kind!=='gear'||listing.owner===user.id) fail(400,'A rental quote is only available to a renter for Gear.');
    const params=new URL(req.url,'http://localhost').searchParams,start=params.get('startDate')||'',end=params.get('endDate')||'';
    if (!validDate(start)||!validDate(end)||end<start) fail(400,'Choose a valid pickup and return date.');
    const quote=await depositQuote(listing,user.id,start,end),days=quote.days,rentAmount=Number(listing.price)*100*days;
    if (!Number.isSafeInteger(rentAmount)||rentAmount<100) fail(400,'The rental total must be at least ₹1.');
    return {depositMinor:quote.amount,rentMinor:rentAmount,totalMinor:rentAmount+quote.amount,days};
  }
  if (method === 'POST' && path === '/listings') {
    const body = await json(req);
    const kind = field(body, 'kind', 4);
    const category = field(body, 'category', 20);
    const categories = { gear: ['Tools','Tech & Camera','Outdoors'], help: ['Home repair','Creative','Lessons'] };
    if (!categories[kind]?.includes(category) || !Number.isInteger(body.price) || body.price < (kind==='gear'?1:0) || body.price > 10000000) fail(400, 'Choose a category and enter a valid whole-rupee price.');
    const itemValueMinor=kind==='gear'?body.itemValueMinor:null;
    if (kind==='gear'&&(!Number.isSafeInteger(itemValueMinor)||itemValueMinor<100||itemValueMinor>100000000000)) fail(400,'Enter an item value from ₹1 to ₹1,000,000,000.');
    const conditionChecklist=kind==='gear'?body.conditionChecklist:null;
    if (kind==='gear'&&(!Array.isArray(conditionChecklist)||conditionChecklist.length<1||conditionChecklist.length>10||conditionChecklist.some(item=>typeof item!=='string'||!item.trim()||item.length>120))) fail(400,'Add 1 to 10 concise condition checklist items.');
    let depositOverride=null;
    if (kind==='gear'&&body.depositOverrideMinor!=null) {
      const maxOverridePercent=Number((await settingValues(['deposit_owner_override_max_percent'])).deposit_owner_override_max_percent||50);
      const base=Math.round(itemValueMinor*Number((await settingValues(['deposit_base_percent'])).deposit_base_percent||25)/100);
      const allowed=Math.round(base*maxOverridePercent/100);
      if (!Number.isSafeInteger(body.depositOverrideMinor)||body.depositOverrideMinor<Math.max(0,base-allowed)||body.depositOverrideMinor>base+allowed) fail(400,'Deposit override must stay within the allowed limit.');
      depositOverride=body.depositOverrideMinor;
    }
    const hasCoordinates = body.latitude != null || body.longitude != null;
    if (hasCoordinates && (typeof body.latitude !== 'number' || typeof body.longitude !== 'number' ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) ||
      Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180)) fail(400,'Invalid listing location.');
    const latitude = hasCoordinates ? Math.round(body.latitude * 100) / 100 : null;
    const longitude = hasCoordinates ? Math.round(body.longitude * 100) / 100 : null;
    const shopId=body.shopId==null||body.shopId===''?'':field(body,'shopId',36);
    let shop=null,listingRole=null,quantity=1,status=body.status||'published';
    if(!['draft','published'].includes(status)) fail(400,'Choose draft or published status.');
    if(shopId) {
      listingRole=await requireShopRole(shopId,user.id);
      shop=await get('SELECT s.plan_key,p.max_active_listings,p.max_quantity_per_listing FROM shop_subscriptions s JOIN shop_subscription_plans p ON p.plan_key=s.plan_key WHERE s.shop_id=? AND s.status=\'active\'',shopId);
      if(!shop) fail(403,'An active shop plan is required to list under this shop.');
      quantity=body.quantity==null?1:Number(body.quantity);
      if(!Number.isInteger(quantity)||quantity<1||quantity>Number(shop.max_quantity_per_listing)) fail(400,'Quantity exceeds the selected shop plan limit.');
      if(status==='published'&&listingRole==='staff') fail(403,'Staff can prepare drafts; a manager or owner must publish them.');
      if(status==='published') {
        const total=await get('SELECT COUNT(*) AS total FROM listings WHERE shop_id=? AND active=1',shopId);
        if(Number(total.total||0)>=Number(shop.max_active_listings)) fail(403,'This shop has reached its active-listing plan limit.');
      }
    } else if(body.quantity!=null&&Number(body.quantity)!==1) fail(400,'Multi-unit stock is available through a shop account.');
    if (body.photo != null) fail(400,'Upload listing photos through the image upload endpoint.');
    const uploadId=field(body,'photoUploadId',36);
    const upload=await get("SELECT storage_key FROM uploads WHERE id=? AND user_id=? AND purpose='listing' AND consumed_at IS NULL AND created_at>?",uploadId,user.id,new Date(Date.now()-3600000).toISOString());
    if (!upload) fail(400,'Upload a new listing photo before publishing.');
    let listingId;
    await query.transaction(async tx => {
      const used=await tx("UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND purpose='listing' AND consumed_at IS NULL",new Date().toISOString(),uploadId,user.id);
      if (!used.changes) fail(400,'That listing photo has already been used. Upload it again.');
      listingId=(await tx('INSERT INTO listings(owner,kind,title,category,price,item_value_minor,condition_checklist,deposit_override_minor,area,description,photo,photo_key,latitude,longitude,shop_id,quantity_available,listing_status,active) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?) RETURNING id',
        user.id,kind,field(body,'title',100),category,body.price,itemValueMinor,JSON.stringify(conditionChecklist||[]),depositOverride,field(body,'area',100),field(body,'description',1200),upload.storage_key,latitude,longitude,shopId||null,quantity,status,status==='published'?1:0)).rows[0].id;
    });
    return {id:listingId};
  }
  const listingAction=path.match(/^\/listings\/(\d+)\/(status|duplicate)$/);
  if(listingAction) {
    const listingId=Number(listingAction[1]),item=await get('SELECT * FROM listings WHERE id=?',listingId);if(!item) fail(404,'Listing unavailable.');
    let role=item.shop_id?await requireShopRole(item.shop_id,user.id):item.owner===user.id?'owner':null;
    if(!role) fail(404,'Listing unavailable.');
    if(listingAction[2]==='status'&&method==='PATCH') {
      if(!['owner','manager'].includes(role)) fail(403,'Only a shop owner or manager can publish listings.');
      const status=field(await json(req),'status',20);if(!['draft','published'].includes(status)) fail(400,'Choose draft or published status.');
      if(status==='published'&&item.shop_id) {
        const plan=await get('SELECT p.max_active_listings FROM shop_subscriptions s JOIN shop_subscription_plans p ON p.plan_key=s.plan_key WHERE s.shop_id=? AND s.status=\'active\'',item.shop_id);
        const total=await get('SELECT COUNT(*) AS total FROM listings WHERE shop_id=? AND active=1',item.shop_id);
        if(!plan||Number(total.total||0)>=Number(plan.max_active_listings)) fail(403,'This shop has reached its active-listing plan limit.');
      }
      const active=status==='published'?1:0;
      if(active===0&&await get("SELECT id FROM requests WHERE listing=? AND status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completion_proposed') LIMIT 1",listingId)) fail(409,'An active booking prevents unpublishing this listing.');
      await run('UPDATE listings SET listing_status=?,active=? WHERE id=?',status,active,listingId);return {ok:true,status};
    }
    if(listingAction[2]==='duplicate'&&method==='POST') {
      const cloned=await run('INSERT INTO listings(owner,kind,title,category,price,item_value_minor,condition_checklist,deposit_override_minor,area,description,photo,photo_key,latitude,longitude,shop_id,quantity_available,listing_status,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,\'draft\',0) RETURNING id',user.id,item.kind,'Copy of '+String(item.title).slice(0,90),item.category,item.price,item.item_value_minor,item.condition_checklist,item.deposit_override_minor,item.area,item.description,item.photo,item.photo_key,item.latitude,item.longitude,item.shop_id,item.quantity_available||1);
      return {id:cloned.rows[0].id,status:'draft'};
    }
  }
  if (match?.[1] === 'listings' && method === 'DELETE') {
    const item=await get('SELECT owner,shop_id FROM listings WHERE id=?',id),role=item?.shop_id?await shopRole(item.shop_id,user.id):item?.owner===user.id?{role:'owner'}:null;
    if(!role||!['owner','manager'].includes(role.role)) fail(404,'Listing unavailable.');
    const result = await run("UPDATE listings SET active=0,listing_status='draft' WHERE id=? AND NOT EXISTS (SELECT 1 FROM requests WHERE listing=? AND (status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completion_proposed') OR (is_gear=1 AND status='completed')))", id,id);
    if (!result.changes) fail(409,'Finish or cancel the active booking before unpublishing.');
    return { ok: true };
  }
  if (match?.[1] === 'saved' && ['PUT','DELETE'].includes(method)) {
    if (method === 'PUT') {
      if (!await get('SELECT id FROM listings WHERE id=? AND active=1', id)) fail(404, 'Listing unavailable.');
      await run('INSERT INTO saved("user",listing) VALUES(?,?) ON CONFLICT DO NOTHING', user.id, id);
    } else await run('DELETE FROM saved WHERE "user"=? AND listing=?', user.id, id);
    return { ok: true };
  }
  if (match?.[1] === 'requests') {
    if (method === 'PUT' && !match[3]) {
    const listing = await get('SELECT owner,kind,category,item_value_minor,deposit_override_minor,quantity_available FROM listings WHERE id=? AND active=1', id);
      if (!listing) fail(404, 'Listing unavailable.');
      if (listing.owner === user.id) fail(400, 'You own this listing.');
      if (user.kycStatus==='suspended') fail(403,'This account cannot request rentals while its identity status is suspended. Contact support.');
      const trust=await trustProfile(user.id);
      if (listing.kind==='gear'&&trust.newRenter&&(listing.item_value_minor==null||!Number.isSafeInteger(Number(listing.item_value_minor))||Number(listing.item_value_minor)>trust.maxItemValueMinor)) fail(403,'New renter accounts can request gear valued up to ₹' + Math.floor(trust.maxItemValueMinor/100).toLocaleString('en-IN') + '. Build rental history before requesting higher-value items.');
      const body = await json(req);
      const start = field(body,'startDate',10);
      const end = listing.kind === 'gear' ? field(body,'endDate',10) : start;
      const details = field(body,'details',1000,listing.kind === 'help');
      if (!validDate(start) || !validDate(end) || start < new Date().toISOString().slice(0,10) || end < start) fail(400,'Choose valid dates starting today or later.');
      if (listing.kind==='gear'&&await get('SELECT id FROM listing_availability_blocks WHERE listing=? AND start_date<=? AND end_date>=?',id,end,start)) fail(409,'The owner has blocked one or more of those dates. Choose another range.');
      let quote={amount:0,days:1,multiplier:1};
      if (listing.kind==='gear') quote=await depositQuote(listing,user.id,start,end);
      const created=await query.transaction(async tx=>{
        const status=listing.kind==='gear'?'requested':'pending';
        const inserted=await tx('INSERT INTO requests(listing,requester,start_date,end_date,details,is_gear,status,deposit_minor,risk_multiplier,due_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id',id,user.id,start,end,details,listing.kind==='gear'?1:0,status,quote.amount,quote.multiplier,listing.kind==='gear'?new Date(Date.parse(end+'T23:59:59.000Z')).toISOString():null);
        const result=inserted.rows[0] || (await tx('SELECT id FROM requests WHERE listing=? AND requester=?',id,user.id)).rows[0];
        if (inserted.rows[0]) await tx('INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,\'none\',?,?,?)',result.id,user.id,status,new Date().toISOString(),JSON.stringify({depositMinor:quote.amount,riskMultiplier:quote.multiplier}));
        return {...result,isNew:Boolean(inserted.rows[0])};
      });
      const saved=await get('SELECT id,deposit_minor,start_date,end_date FROM requests WHERE id=?',created.id);
      if (created.isNew) {
        const summary=await get('SELECT l.owner,l.title,u.name AS renter_name FROM listings l JOIN users u ON u.id=? WHERE l.id=?',user.id,id);
        if (summary) notifyUser(summary.owner,'booking:'+created.id+':request','A neighbour requested your listing',summary.renter_name+' requested '+summary.title+' for '+start+(listing.kind==='gear'?' through '+end:'')+'. Sign in to review the request.');
      }
      return {...created,depositMinor:Number(saved.deposit_minor||0),days:Math.max(1,Math.round((Date.parse(saved.end_date)-Date.parse(saved.start_date))/86400000)+1)};
    }
    const thread = await get(threads + ' WHERE r.id=? AND (r.requester=? OR l.owner=?)', id, user.id, user.id);
    if (!thread) fail(404, 'Conversation unavailable.');
    if(Number(thread.is_demo)===1 && (method!=='GET'||['checkout','contact'].includes(match[3]))) fail(409,'This sample booking is read-only. Create a new request to try the live booking flow.');
    if (match[3] === 'audit' && method === 'GET') return await all('SELECT actor_user_id,old_status,new_status,occurred_at FROM booking_status_audit WHERE booking=? ORDER BY id',id);
    if (match[3]==='evidence'&&method==='GET') return await all('SELECT e.id,e.uploader_user_id,e.phase,e.uploaded_at,u.name FROM booking_evidence e JOIN users u ON u.id=e.uploader_user_id WHERE e.booking=? ORDER BY e.uploaded_at',id);
    if (match[3] === 'messages' && method === 'GET') {await run('UPDATE messages SET read_at=? WHERE request=? AND sender<>? AND read_at IS NULL',new Date().toISOString(),id,user.id);return (await all('SELECT id,sender,body,sent FROM messages WHERE request=? ORDER BY id DESC LIMIT 200', id)).reverse();}
    if (match[3] === 'messages' && method === 'POST') {
      const body=field(await json(req),'message',2000),sent=await run('INSERT INTO messages(request,sender,body) VALUES(?,?,?) RETURNING id',id,user.id,body);
      const recipient=thread.owner===user.id?thread.requester:thread.owner;
      notifyUser(recipient,'message:'+sent.rows[0].id,'New NeighbourLink message','You have a new message about '+thread.title+'. Sign in to continue the conversation.');
      return { ok: true };
    }
    if (match[3]==='evidence'&&method==='POST') {
      if (!thread.is_gear) fail(400,'Photo evidence is only used for Gear rentals.');
      const body=await json(req),phase=body.phase;
      if (!['handover','return'].includes(phase)) fail(400,'Choose handover or return evidence.');
      if (phase==='handover'&&thread.status!=='paid') fail(409,'Handover photos are available after payment.');
      if (phase==='return'&&thread.status!=='active') fail(409,'Return photos are available after handover.');
      const uploadId=field(body,'uploadId',36);
      const purpose=phase==='handover'?'booking-handover':'booking-return';
      const upload=await get('SELECT storage_key,content_type FROM uploads WHERE id=? AND user_id=? AND purpose=? AND consumed_at IS NULL AND created_at>?',uploadId,user.id,purpose,new Date(Date.now()-3600000).toISOString());
      if (!upload) fail(400,'Upload a new timestamped photo for this booking.');
      const now=new Date().toISOString();let lateFeeMinor=0;
      await query.transaction(async tx=>{
        const used=await tx('UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND consumed_at IS NULL',now,uploadId,user.id);
        if (!used.changes) fail(400,'That photo has already been attached. Upload it again.');
        await tx('INSERT INTO booking_evidence(id,booking,uploader_user_id,phase,storage_key,content_type,uploaded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),id,user.id,phase,upload.storage_key,upload.content_type,now);
        const count=await tx('SELECT COUNT(DISTINCT uploader_user_id) AS count FROM booking_evidence WHERE booking=? AND phase=?',id,phase);
        if (Number(count.rows[0].count)===2) {
          const old=phase==='handover'?'paid':'active',next=phase==='handover'?'active':'returned';
          const hours=phase==='return'?Number((await tx('SELECT setting_value FROM marketplace_settings WHERE setting_key=?','claim_window_hours')).rows[0]?.setting_value||24):null;
          const deadline=phase==='return'?new Date(Date.now()+hours*3600000).toISOString():null;
          const changed=await tx('UPDATE requests SET status=?,pickup_at=CASE WHEN ?=\'active\' THEN ? ELSE pickup_at END,return_at=CASE WHEN ?=\'returned\' THEN ? ELSE return_at END,claim_deadline=COALESCE(?,claim_deadline) WHERE id=? AND status=?',next,next,now,next,now,deadline,id,old);
          if (!changed.changes) fail(409,'The booking changed before both photos were saved.');
          await tx('INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,?,?,?,?)',id,user.id,old,next,now,JSON.stringify({evidencePhase:phase}));
          if (phase==='return') {
            await tx("UPDATE requests SET status='claim_window' WHERE id=? AND status='returned'",id);
            await tx("INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,'returned','claim_window',?,?)",id,user.id,now,JSON.stringify({claimDeadline:deadline}));
            const fees=await tx('SELECT setting_key,setting_value FROM marketplace_settings WHERE setting_key IN (?,?)','late_fee_per_day_minor','late_fee_grace_hours');
            const cfg=Object.fromEntries(fees.rows.map(row=>[row.setting_key,Number(row.setting_value)]));
            const booking=await tx('SELECT due_at,deposit_minor FROM requests WHERE id=?',id);
            const grace=(cfg.late_fee_grace_hours||0)*3600000;
            const lateMs=Date.now()-Date.parse(booking.rows[0].due_at||now)-grace;
            if (lateMs>0) {
              const lateDays=Math.ceil(lateMs/86400000),fee=Math.min(Number(booking.rows[0].deposit_minor||0),lateDays*(cfg.late_fee_per_day_minor||0));
              if (fee>0) {
                lateFeeMinor=fee;
                await tx('INSERT INTO booking_late_fees(booking,amount_minor,assessed_at) VALUES(?,?,?) ON CONFLICT(booking) DO NOTHING',id,fee,now);
                await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,idempotency_key,actor_user_id,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',id,'late_fee_assessed',fee,'INR','policy','booking:'+id+':late-fee',user.id,JSON.stringify({lateDays}),now);
              }
            }
          }
        }
      });
      return {ok:true,phase,lateFeeMinor};
    }
    if (match[3]==='claim'&&method==='GET') {
      return await get('SELECT owner_user_id,reason,status,renter_response,created_at,responded_at,resolved_at,resolution,resolution_reason,deduction_minor FROM booking_claims WHERE booking=?',id)||null;
    }
    if (match[3]==='claim'&&method==='POST') {
      if (thread.owner!==user.id||thread.status!=='claim_window'||!thread.claim_deadline||Date.now()>Date.parse(thread.claim_deadline)) fail(409,'Owner claims can only be raised during the return claim window.');
      const body=await json(req),reason=field(body,'reason',1000),uploadId=field(body,'uploadId',36);
      const upload=await get("SELECT storage_key,content_type FROM uploads WHERE id=? AND user_id=? AND purpose='booking-claim' AND consumed_at IS NULL AND created_at>?",uploadId,user.id,new Date(Date.now()-3600000).toISOString());
      if (!upload) fail(400,'Upload a new supporting claim photo before submitting.');
      const now=new Date().toISOString();
      await query.transaction(async tx=>{
        const used=await tx("UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND purpose='booking-claim' AND consumed_at IS NULL",now,uploadId,user.id);
        if (!used.changes) fail(400,'That claim photo has already been used. Upload it again.');
        await tx('INSERT INTO booking_claims(booking,owner_user_id,reason,created_at) VALUES(?,?,?,?)',id,user.id,reason,now);
        await tx('INSERT INTO booking_claim_evidence(id,booking,uploader_user_id,storage_key,content_type,uploaded_at) VALUES(?,?,?,?,?,?)',randomUUID(),id,user.id,upload.storage_key,upload.content_type,now);
        await tx("INSERT INTO booking_claim_audit(booking,actor_user_id,event_type,event_data,occurred_at) VALUES(?,?,'claim_created',?,?)",id,user.id,JSON.stringify({reason}),now);
        const changed=await tx("UPDATE requests SET status='disputed' WHERE id=? AND status='claim_window'",id);
        if (!changed.changes) fail(409,'The claim window has closed.');
        await tx("INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,'claim_window','disputed',?,?)",id,user.id,now,JSON.stringify({claim:true}));
      });
      notifyUser(thread.requester,'booking:'+id+':claim','An owner raised a rental claim',thread.title+': the owner submitted a claim with a supporting photo. Sign in to review it and respond.');
      return {ok:true,status:'disputed'};
    }
    if (match[3]==='claim'&&method==='PATCH') {
      if (thread.requester!==user.id||thread.status!=='disputed') fail(409,'Only the renter can respond while a claim is open.');
      const response=field(await json(req),'response',1200),now=new Date().toISOString();
      const saved=await query.transaction(async tx=>{
        const changed=await tx("UPDATE booking_claims SET renter_response=?,responded_at=? WHERE booking=? AND status='open' AND renter_response IS NULL",response,now,id);
        if (!changed.changes) fail(409,'A response was already submitted or this claim is being reviewed.');
        await tx("INSERT INTO booking_claim_audit(booking,actor_user_id,event_type,event_data,occurred_at) VALUES(?,?,'renter_response',?,?)",id,user.id,JSON.stringify({response}),now);
        return true;
      });
      notifyUser(thread.owner,'booking:'+id+':claim-response','The renter responded to a claim',thread.title+': the renter has submitted a response. Sign in to review the case.');
      return {ok:saved};
    }
    if (match[3]==='contact'&&method==='GET') {
      if (!thread.is_gear||!['paid','active','returned','disputed','completed','resolved'].includes(thread.status)) fail(403,'Contact details are available to booking participants after confirmed payment.');
      const otherUser=thread.owner===user.id?thread.requester:user.id===thread.requester?thread.owner:null;
      if (!otherUser) fail(404,'Contact unavailable.');
      return await get('SELECT name,phone FROM users WHERE id=?',otherUser);
    }
    if (match[3] === 'checkout') {
      const days = thread.kind === 'gear' && thread.start_date && thread.end_date
        ? Math.round((Date.parse(thread.end_date) - Date.parse(thread.start_date)) / 86400000) + 1 : 1;
      const rentAmount = Math.round(Number(thread.agreed_price) * 100) * days;
      const depositAmount=Number(thread.deposit_minor||0);
      const commissionRate=(await settingValues(['commission_percent'])).commission_percent||10;
      if (commissionRate<0||commissionRate>=100) fail(503,'The commission setting is invalid. Contact support.');
      const commissionAmount=Math.round(rentAmount*commissionRate/100);
      const amount=rentAmount+depositAmount;
      const existing = await get('SELECT * FROM protected_payments WHERE booking=?', id);
      if (method === 'GET') {
        if (thread.kind!=='gear') fail(400,'Protected payment checkout is for Gear rentals only.');
        if (thread.status!=='accepted'||thread.agreed_price==null) fail(409,'Checkout is available after the owner accepts the request.');
        if (!Number.isSafeInteger(amount)||amount<=0||depositAmount<=0) fail(409,'This booking has no protected deposit quote. Cancel it and submit a new rental request.');
        return {mode:payments?.mode||'unavailable',keyId:payments?.keyId||null,amount,currency:'INR',days,rentAmount,depositAmount,commissionAmount,status:existing?.payment_status||'unpaid',orderId:existing?.provider_order_id||null};
      }
      if (method === 'POST') {
        if (thread.requester !== user.id) fail(403,'Only the customer can use checkout.');
        if (thread.status !== 'accepted' || thread.agreed_price == null || !Number.isSafeInteger(amount)||depositAmount<=0||thread.kind!=='gear') fail(409,'Checkout requires an accepted Gear rental with a protected deposit quote.');
        if (!payments) fail(503,'Protected payments are unavailable until Razorpay TEST credentials and Route approval are configured.');
        const account=await get("SELECT account_id FROM owner_payment_accounts WHERE user_id=? AND provider='razorpay'",thread.owner);
        if (!account) fail(409,'The owner must connect an activated Razorpay Route account before checkout.');
        const now=new Date().toISOString(),reservationId='pending_'+randomUUID();
        const reservation=await query.transaction(async tx=>{
          const row=(await tx('SELECT * FROM protected_payments WHERE booking=?',id)).rows[0];
          if (row?.payment_status==='captured') return {kind:'captured',row};
          if (row?.payment_status==='created') return {kind:'created',row};
          if (row?.payment_status==='creating'&&Date.now()-Date.parse(row.created_at)<120000) return {kind:'busy'};
          if (row) {
            const update=await tx(`UPDATE protected_payments SET provider_order_id=?,payment_status='creating',amount_minor=?,rent_minor=?,deposit_minor=?,commission_minor=?,created_at=?,updated_at=? WHERE booking=? AND payment_status IN ('failed','creating')`,reservationId,amount,rentAmount,depositAmount,commissionAmount,now,now,id);
            if (!update.changes) return {kind:'busy'};
          } else {
            const insert=await tx(`INSERT INTO protected_payments(booking,provider,provider_order_id,payment_status,amount_minor,rent_minor,deposit_minor,commission_minor,created_at,updated_at) VALUES(?,?,?,'creating',?,?,?,?,?,?) ON CONFLICT(booking) DO NOTHING`,id,'razorpay',reservationId,amount,rentAmount,depositAmount,commissionAmount,now,now);
            if (!insert.changes) return {kind:'busy'};
          }
          return {kind:'reserved'};
        });
        if (reservation.kind==='captured') return {status:'captured',orderId:reservation.row.provider_order_id};
        if (reservation.kind==='created') return {ok:true,status:'created',orderId:reservation.row.provider_order_id,keyId:payments.keyId,amount:reservation.row.amount_minor,currency:'INR',name:'NeighbourLink'};
        if (reservation.kind==='busy') fail(409,'A payment order is already being prepared. Refresh in a moment.');
        let order;
        try { order=await payments.createOrder({amount,booking:id,ownerAccountId:account.account_id,ownerAmount:rentAmount-commissionAmount,depositAmount}); }
        catch(error) { await run("UPDATE protected_payments SET payment_status='failed',updated_at=? WHERE booking=? AND provider_order_id=? AND payment_status='creating'",new Date().toISOString(),id,reservationId);throw error; }
        if (!order?.id) {
          await run("UPDATE protected_payments SET payment_status='failed',updated_at=? WHERE booking=? AND provider_order_id=? AND payment_status='creating'",new Date().toISOString(),id,reservationId);
          fail(503,'Razorpay did not create the payment order.');
        }
        await query.transaction(async tx=>{
          const saved=await tx("UPDATE protected_payments SET provider_order_id=?,payment_status='created',updated_at=? WHERE booking=? AND provider_order_id=? AND payment_status='creating'",order.id,now,id,reservationId);
          if (!saved.changes) fail(409,'The payment order reservation expired. Start checkout again.');
          await tx('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,provider,provider_reference,idempotency_key,actor_user_id,metadata,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,'payment_order',amount,'INR','razorpay',order.id,'booking:'+id+':order:'+order.id,user.id,JSON.stringify({rentAmount,depositAmount,commissionAmount}),now);
        });
        return {ok:true,status:'created',orderId:order.id,keyId:payments.keyId,amount,currency:'INR',name:'NeighbourLink'};
      }
    }
    if (path.endsWith('/checkout/verify')&&method==='POST') {
      if (thread.requester!==user.id) fail(403,'Only the renter can verify checkout.');
      if (!payments) fail(503,'Protected payments are unavailable.');
      const body=await json(req),orderId=field(body,'razorpay_order_id',80),paymentId=field(body,'razorpay_payment_id',80),checkoutSignature=field(body,'razorpay_signature',128);
      const paymentRow=await get('SELECT * FROM protected_payments WHERE booking=? AND provider_order_id=?',id,orderId);
      if (!paymentRow) fail(400,'Payment order not found.');
      if (!payments.verifyCheckout({orderId,paymentId,checkoutSignature})) fail(400,'The payment confirmation signature is invalid.');
      if (paymentRow.payment_status==='captured'&&paymentRow.provider_payment_id===paymentId) return {ok:true,status:'paid'};
      return await recordPaymentCaptured(paymentRow,paymentId,user.id);
    }
    if (match[3] === 'rating' && method === 'POST') {
      if (thread.kind==='gear') {
        if (![thread.requester,thread.owner].includes(user.id)||!['completed','resolved'].includes(thread.status)) fail(403,'Only a booking participant can review after resolution.');
        const body=await json(req);
        if (!Number.isInteger(body.score)||body.score<1||body.score>5) fail(400,'Choose a rating from 1 to 5.');
        const ratee=user.id===thread.requester?thread.owner:thread.requester;
        const result=await run('INSERT INTO booking_ratings(booking,rater_user_id,ratee_user_id,score,comment,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING',id,user.id,ratee,body.score,field(body,'comment',500,false),new Date().toISOString());
        if (!result.changes) fail(409,'You already reviewed this booking.');
        return {ok:true};
      }
      if (thread.requester !== user.id || !['completed','resolved'].includes(thread.status)) fail(403, 'Only the customer can review a completed booking.');
      const body = await json(req);
      if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) fail(400, 'Choose a rating from 1 to 5.');
      const result = await run('INSERT INTO ratings(booking,score,comment) VALUES(?,?,?) ON CONFLICT DO NOTHING', id,body.score,field(body,'comment',500,false));
      if (!result.changes) fail(409, 'You already reviewed this booking.');
      return { ok: true };
    }
    if (method === 'PATCH' && !match[3]) {
      const { status } = await json(req);
      const owner = user.id === thread.owner;
      if (thread.kind==='gear'&&thread.status==='paid'&&status==='cancelled') {
        const hours=(await settingValues(['cancellation_free_hours'])).cancellation_free_hours||24;
        const pickup=Date.parse(thread.start_date+'T00:00:00.000Z');
        if (!Number.isFinite(pickup)||pickup-Date.now()<hours*3600000) fail(409,'Free cancellation is closed. Contact support to discuss this booking.');
        return await cancelPaidBooking(id,user.id);
      }
      const transitions = {
        pending: owner ? ['accepted','declined'] : ['cancelled'],
        requested: owner ? ['accepted','declined'] : ['cancelled'],
        accepted: thread.kind==='gear' ? ['cancelled'] : owner ? ['completion_proposed','cancelled'] : ['cancelled'],
        active: thread.kind==='gear'?[]:owner?[]:['returned'],
        returned: thread.kind==='gear'?[]:owner?['completed']:[],
        paid: ['cancelled'],
        claim_window: [],
        disputed: [],
        completion_proposed: owner ? [] : ['completed']
      };
      const allowed = transitions[thread.status] || [];
      if (!allowed.includes(status)) fail(409, 'This request cannot change to that status.');
      const booking = status === 'accepted' && thread.kind === 'gear' && thread.start_date;
      const overlap = " AND (SELECT COUNT(*) FROM requests booked WHERE booked.listing=? AND booked.id<>? AND booked.status IN ('accepted','paid','active','returned','claim_window','disputed','resolved','completed') AND booked.start_date<=? AND booked.end_date>=?) < (SELECT quantity_available FROM listings WHERE id=?) AND NOT EXISTS (SELECT 1 FROM listing_availability_blocks avb WHERE avb.listing=? AND avb.start_date<=? AND avb.end_date>=?)";
      try {
        const column = {accepted:'accepted_at', active:'pickup_at', returned:'return_at', completed:'completed_at'}[status];
        const assignments = ['status=?'];
        const values = [status];
        if (column) {
          assignments.push(column + '=?');
          values.push(new Date().toISOString());
        }
        if (status === 'accepted') {
          assignments.push('agreed_price=?');
          values.push(String(thread.listing_price));
        }
        await query.transaction(async tx => {
          if(booking) await tx('UPDATE listings SET quantity_available=quantity_available WHERE id=?',thread.listing);
          const result = await tx('UPDATE requests SET ' + assignments.join(', ') + ' WHERE id=? AND status=?' + (booking ? overlap : ''),
            ...values,id,thread.status,...(booking ? [thread.listing,id,thread.end_date,thread.start_date,thread.listing,thread.listing,thread.end_date,thread.start_date] : []));
          if (!result.changes) fail(409, booking ? 'These rental dates are already booked or the request changed.' : 'Request changed. Refresh and try again.');
          await tx('INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,?,?,?,?)',
            id,user.id,thread.status,status,new Date().toISOString(),'{}');
        });
      } catch (error) {
        if (error.code === '23P01') fail(409,'These rental dates are already booked.');
        throw error;
      }
      const otherParty=owner?thread.requester:thread.owner;
      if (['accepted','declined','cancelled','completed','completion_proposed'].includes(status)) notifyUser(otherParty,'booking:'+id+':status:'+status,'Booking update: '+status.replaceAll('_',' '),thread.title+' is now '+status.replaceAll('_',' ')+'. Sign in to see the details.');
      return { ok: true };
    }
  }
  if (match?.[1] === 'reports' && method === 'POST') {
    if (!await get('SELECT id FROM listings WHERE id=? AND active=1', id)) fail(404, 'Listing unavailable.');
    await run('INSERT INTO reports(listing,reporter,reason) VALUES(?,?,?) ON CONFLICT DO NOTHING', id, user.id, field(await json(req),'reason',500));
    return { ok: true };
  }
  if (match?.[1] === 'reports' && method === 'PATCH' && admin) {
    const { status } = await json(req);
    const report = await get('SELECT listing FROM reports WHERE id=? AND status=?', id, 'open');
    if (!report || !['dismissed','removed'].includes(status)) fail(400, 'Invalid report action.');
    if (status === 'removed') await run('UPDATE listings SET active=0 WHERE id=?', report.listing);
    await run('UPDATE reports SET status=? WHERE id=?', status, id);
    return { ok: true };
  }
  fail(404, 'Endpoint unavailable.');
}

async function cleanupReviewedKycDocuments() {
  const setting=await get("SELECT setting_value FROM marketplace_settings WHERE setting_key='kyc_document_retention_days'");
  const retentionDays=Math.max(1,Number(setting?.setting_value)||90);
  const cutoff=new Date(Date.now()-retentionDays*86400000).toISOString();
  const expired=await all('SELECT user_id,id_storage_key,selfie_storage_key FROM kyc_cases WHERE reviewed_at IS NOT NULL AND reviewed_at<? AND (id_storage_key IS NOT NULL OR selfie_storage_key IS NOT NULL)',cutoff);
  for (const row of expired) {
    for (const key of [row.id_storage_key,row.selfie_storage_key]) if (key) await storage.remove(key).catch(()=>{});
    await run('UPDATE kyc_cases SET id_storage_key=NULL,selfie_storage_key=NULL WHERE user_id=? AND reviewed_at<?',row.user_id,cutoff);
  }
}
cleanupReviewedKycDocuments().catch(()=>{});
const kycCleanupTimer=setInterval(()=>cleanupReviewedKycDocuments().catch(()=>{}),86400000);
kycCleanupTimer.unref();
const claimTimer=setInterval(()=>processClaimWindows().catch(error=>console.error('Claim window worker failed:',error.message)),30000);
claimTimer.unref();
processClaimWindows().catch(()=>{});
const notificationTimer=setInterval(()=>processNotifications().catch(error=>console.error('Notification delivery worker failed:',error.message)),5000);
notificationTimer.unref();
processNotifications().catch(()=>{});

createServer(async (req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const frameAncestors = ['/landing.html','/borrow.html'].includes(path) ? "'self'" : "'none'";
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.bigdatacloud.net https://api.razorpay.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors " + frameAncestors + "; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  try {
    const viewer = ['/', '/login', '/profile', '/landing.html', '/borrow.html'].includes(path) ? await sessionUser(req) : null;
    const protectedPages=['/','/profile','/landing.html','/borrow.html'];
    if (req.method === 'GET' && protectedPages.includes(path) && !viewer) {
      res.writeHead(302, { Location:'/login' }).end();
    } else if (req.method === 'GET' && path === '/login' && viewer) {
      const invitation=new URL(req.url,'http://localhost').searchParams.get('shopInvite');
      res.writeHead(302, { Location:(viewer.emailVerified ? '/' : '/verify-email')+(invitation?'?shopInvite='+encodeURIComponent(invitation):'') }).end();
    } else if (req.method === 'GET' && protectedPages.includes(path) && viewer && !viewer.emailVerified) {
      res.writeHead(302, { Location:'/verify-email' }).end();
    } else if (req.method === 'GET' && protectedPages.includes(path) && path !== '/profile' && viewer && !viewer.profileComplete) {
      res.writeHead(302, { Location:'/profile' }).end();
    } else if (req.method === 'GET' && path === '/profile' && viewer?.profileComplete) {
      res.writeHead(302, { Location:'/' }).end();
    } else if (req.method==='POST'&&path==='/api/v1/webhooks/razorpay') {
      const result=await handlePaymentWebhook(req,res);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(result));
    } else if (path.startsWith('/api/v1/')) {
      const data = await api(req,res,path.slice(7));
      if (data?.binary) res.writeHead(200,{'Content-Type':data.contentType,'Content-Disposition':'inline','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data.bytes);
      else res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
    } else if (req.method === 'GET' && assets.has(path)) {
      const [file, mime] = assets.get(path);
      res.writeHead(200, {'Content-Type':mime.startsWith('image/') ? mime : mime + '; charset=utf-8'}).end(readFileSync(new URL(file,import.meta.url)));
    } else if (req.method === 'GET' && /^\/photos\/\d+\/[12]$/.test(path)) {
      const [,listingId,position]=path.match(/^\/photos\/(\d+)\/([12])$/);
      const row=await get('SELECT dp.storage_key FROM demo_listing_photos dp JOIN listings l ON l.id=dp.listing WHERE dp.listing=? AND dp.position=? AND l.active=1',Number(listingId),Number(position));
      if(!row) fail(404,'Photo unavailable.');
      const photo=await storage.get(row.storage_key);if(!photo) fail(404,'Photo unavailable.');
      res.writeHead(200,{'Content-Type':photo.contentType,'Cache-Control':'private, max-age=300'}).end(photo.bytes);
    } else if (req.method === 'GET' && /^\/photos\/\d+$/.test(path)) {
      const row=await get('SELECT photo,photo_key FROM listings WHERE id=? AND active=1',Number(path.slice(8)));
      if (!row) fail(404,'Photo unavailable.');
      if (row.photo_key) {
        const photo=await storage.get(row.photo_key);
        if (!photo) fail(404,'Photo unavailable.');
        res.writeHead(200,{'Content-Type':photo.contentType,'Cache-Control':'private, max-age=300'}).end(photo.bytes);
      } else if (row.photo) {
        const [format,body]=row.photo.split(';base64,');
        res.writeHead(200,{'Content-Type':format.slice(5),'Cache-Control':'private, max-age=300'}).end(Buffer.from(body,'base64'));
      } else fail(404,'Photo unavailable.');
    } else fail(404,'Page unavailable.');
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) res.writeHead(error.status || 500, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ error: error.status ? error.message : 'Something went wrong. Please try again.' }));
  }
}).listen(Number(process.env.PORT || 8767), process.env.HOST || '127.0.0.1', function () {
  console.log('NeighbourLink listening on port ' + this.address().port);
});
