import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase } from './database.mjs';
import { createObjectStorage, MAX_IMAGE_BYTES, validateImage } from './storage.mjs';
import { sendEmail, takeTestMessages } from './email.mjs';
import { sendSms, takeTestMessages as takeTestSms } from './sms.mjs';
import { createKycAdapter } from './kyc.mjs';

const query = await openDatabase();
const storage = await createObjectStorage();
const kyc = createKycAdapter();
const secure = process.env.COOKIE_SECURE === '1';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const all = async (sql, ...args) => (await query(sql, ...args)).rows;
const get = async (sql, ...args) => (await all(sql, ...args))[0];
const run = async (sql, ...args) => query(sql, ...args);
const listings = 'SELECT l.id,l.owner,l.kind,l.title,l.category,l.price,l.item_value_minor,l.area,l.latitude,l.longitude,l.description,l.active,(l.photo IS NOT NULL OR l.photo_key IS NOT NULL) AS hasPhoto,u.name FROM listings l JOIN users u ON u.id=l.owner';
const threads = 'SELECT r.*,(SELECT status FROM demo_payments WHERE booking=r.id) AS payment_status,l.price AS listing_price,(SELECT score FROM ratings WHERE booking=r.id) AS score,l.title,l.owner,l.kind,u.name AS "requesterName",o.name AS "ownerName" FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=r.requester JOIN users o ON o.id=l.owner';
const assets = new Map([['/', ['index.html','text/html']], ['/login', ['index.html','text/html']], ['/profile', ['index.html','text/html']], ['/verify-email', ['index.html','text/html']], ['/reset-password', ['index.html','text/html']], ['/landing.html', ['landing.html','text/html']], ['/landing.js', ['landing.js','text/javascript']], ['/borrow.html', ['borrow.html','text/html']], ['/borrow.js', ['borrow.js','text/javascript']], ['/portal.js', ['portal.js','text/javascript']], ['/portal.css', ['portal.css','text/css']], ['/app.js',['app.js','text/javascript']], ['/app.css',['app.css','text/css']]]);
for (const name of ['camera','tent','bicycle']) {
  assets.set('/examples/' + name + '.jpg', ['photos/' + name + '.jpg','image/jpeg']);
}
const attempts = new Map();
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
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
    get("SELECT COUNT(*) AS count FROM requests WHERE requester=? AND status='completed'",userId),
    get('SELECT AVG(rate.score) AS average FROM ratings rate JOIN requests r ON r.id=rate.booking JOIN listings l ON l.id=r.listing WHERE l.owner=?',userId),
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
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + (kind === 'verify' ? 24 : 1) * 60 * 60 * 1000).toISOString();
  const table = kind === 'verify' ? 'email_verification_tokens' : 'password_reset_tokens';
  await run('UPDATE ' + table + ' SET used_at=? WHERE user_id=? AND used_at IS NULL',now.toISOString(),user.id);
  await run('INSERT INTO ' + table + '(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',digest(token),user.id,expires,now.toISOString());
  const route = kind === 'verify' ? '/verify-email' : '/reset-password';
  const url = emailOrigin(req) + route + '?token=' + encodeURIComponent(token);
  const subject = kind === 'verify' ? 'Confirm your NeighbourLink email' : 'Reset your NeighbourLink password';
  const action = kind === 'verify' ? 'Confirm email' : 'Choose a new password';
  const text = kind === 'verify' ? 'Confirm your email address: ' + url + '\nThis link expires in 24 hours.' : 'Reset your password: ' + url + '\nThis link expires in 1 hour.';
  const html = '<p>' + action + ' for your NeighbourLink account.</p><p><a href="' + url + '">' + action + '</a></p><p>This link expires in ' + (kind === 'verify' ? '24 hours.' : '1 hour.') + '</p>';
  try { await sendEmail({to:user.email,subject,text,html}); }
  catch (error) { fail(503,error.message || 'Email delivery is unavailable.'); }
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
    return takeTestMessages(recipient);
  }
  if (process.env.NODE_ENV === 'test' && method === 'GET' && path === '/__test/sms') {
    const recipient = new URL(req.url,'http://localhost').searchParams.get('to') || '';
    return takeTestSms(recipient);
  }
  if (process.env.NODE_ENV === 'test' && method === 'GET' && path === '/__test/kyc-audit') {
    return {access:(await get('SELECT COUNT(*) AS count FROM kyc_access_audit')).count,reviews:(await get('SELECT COUNT(*) AS count FROM kyc_review_audit')).count};
  }
  if (method === 'POST' && path === '/verify-email') {
    const token = field(await json(req),'token',64);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400,'That confirmation link is invalid or expired.');
    const tokenHash=digest(token),now=new Date().toISOString();
    const record=await get('SELECT user_id FROM email_verification_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',tokenHash,now);
    if (!record) fail(400,'That confirmation link is invalid or expired.');
    await query.transaction(async tx => {
      const used=await tx('UPDATE email_verification_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?',now,tokenHash,now);
      if (!used.changes) fail(400,'That confirmation link is invalid or expired.');
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
    if (path === '/signup') await issueEmailToken(req,{id:account.id,email},'verify');
    if (token) await run('DELETE FROM sessions WHERE token=?', digest(token));
    await session(res, account.id);
    return { ok: true };
  }
  if (!user) fail(401, 'Sign in to continue.');
  if (method === 'POST' && path === '/email-verification/resend') {
    if (!user.emailVerified) {
      throttle(req.socket.remoteAddress);
      await issueEmailToken(req,user,'verify');
    }
    return {ok:true};
  }
  if (!user.emailVerified && !['/logout'].includes(path)) fail(403,'Confirm your email to continue.');
  if (method === 'POST' && path === '/phone-otp/send') {
    throttle(req.socket.remoteAddress);
    const profile=await get('SELECT phone,phone_verified_at FROM users WHERE id=?',user.id);
    if (!profile?.phone || !/^\+?[1-9]\d{7,14}$/.test(profile.phone)) fail(400,'Save a valid phone number before requesting a code.');
    if (profile.phone_verified_at) return {ok:true,verified:true};
    const recent=await get("SELECT COUNT(*) AS count FROM phone_otp_challenges WHERE user_id=? AND created_at>?",user.id,new Date(Date.now()-3600000).toISOString());
    if (Number(recent.count)>=3) fail(429,'You have requested several codes. Try again in an hour.');
    const code=String(randomInt(0,1000000)).padStart(6,'0');
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
    if (!['profile','listing','kyc-id','kyc-selfie'].includes(purpose)) fail(400,'Choose a valid image purpose.');
    if (purpose === 'listing' && !user.profileComplete) fail(403,'Complete your profile before listing items.');
    if (purpose.startsWith('kyc-') && !user.profileComplete) fail(403,'Verify your phone and finish your profile before identity verification.');
    const {bytes,contentType,image}=await readImageRequest(req);
    const id=randomUUID();
    const storageKey='users/' + user.id + '/' + purpose + '/' + id + '.' + image.extension;
    await storage.put(storageKey,purpose.startsWith('kyc-') ? kyc.encrypt(bytes) : bytes,purpose.startsWith('kyc-') ? 'application/octet-stream' : contentType);
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
  if (method === 'GET' && path === '/listings') return await all(listings + ' WHERE l.active=1 ORDER BY l.id DESC');
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
  if (method === 'GET' && path === '/activity') return {
    listings: await all(listings + ' WHERE l.owner=? ORDER BY l.id DESC', user.id),
    saved: (await all('SELECT listing FROM saved WHERE "user"=?', user.id)).map(row => row.listing),
    threads: await all(threads + ' WHERE r.requester=? OR l.owner=? ORDER BY r.id DESC', user.id, user.id),
    reports: admin ? await all('SELECT reports.*,listings.title FROM reports JOIN listings ON listings.id=reports.listing WHERE reports.status=?', 'open') : []
  };
  const match = path.match(/^\/(listings|saved|requests|reports)\/(\d+)(?:\/(messages|rating|checkout|audit))?$/);
  const id = match && Number(match[2]);
  if (method === 'POST' && path === '/listings') {
    const body = await json(req);
    const kind = field(body, 'kind', 4);
    const category = field(body, 'category', 20);
    const categories = { gear: ['Tools','Tech & Camera','Outdoors'], help: ['Home repair','Creative','Lessons'] };
    if (!categories[kind]?.includes(category) || !Number.isInteger(body.price) || body.price < 0 || body.price > 10000000) fail(400, 'Choose a category and enter a valid whole-rupee price.');
    const itemValueMinor=kind==='gear'?body.itemValueMinor:null;
    if (kind==='gear'&&(!Number.isSafeInteger(itemValueMinor)||itemValueMinor<100||itemValueMinor>100000000000)) fail(400,'Enter an item value from ₹1 to ₹1,000,000,000.');
    const hasCoordinates = body.latitude != null || body.longitude != null;
    if (hasCoordinates && (typeof body.latitude !== 'number' || typeof body.longitude !== 'number' ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) ||
      Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180)) fail(400,'Invalid listing location.');
    const latitude = hasCoordinates ? Math.round(body.latitude * 100) / 100 : null;
    const longitude = hasCoordinates ? Math.round(body.longitude * 100) / 100 : null;
    if (body.photo != null) fail(400,'Upload listing photos through the image upload endpoint.');
    const uploadId=field(body,'photoUploadId',36);
    const upload=await get("SELECT storage_key FROM uploads WHERE id=? AND user_id=? AND purpose='listing' AND consumed_at IS NULL AND created_at>?",uploadId,user.id,new Date(Date.now()-3600000).toISOString());
    if (!upload) fail(400,'Upload a new listing photo before publishing.');
    let listingId;
    await query.transaction(async tx => {
      const used=await tx("UPDATE uploads SET consumed_at=? WHERE id=? AND user_id=? AND purpose='listing' AND consumed_at IS NULL",new Date().toISOString(),uploadId,user.id);
      if (!used.changes) fail(400,'That listing photo has already been used. Upload it again.');
      listingId=(await tx('INSERT INTO listings(owner,kind,title,category,price,item_value_minor,area,description,photo,photo_key,latitude,longitude) VALUES(?,?,?,?,?,?,?, ?,NULL,?,?,?) RETURNING id',
        user.id,kind,field(body,'title',100),category,body.price,itemValueMinor,field(body,'area',100),field(body,'description',1200),upload.storage_key,latitude,longitude)).rows[0].id;
    });
    return {id:listingId};
  }
  if (match?.[1] === 'listings' && method === 'DELETE') {
    if (!await get('SELECT id FROM listings WHERE id=? AND owner=?', id,user.id)) fail(404,'Listing unavailable.');
    const result = await run("UPDATE listings SET active=0 WHERE id=? AND owner=? AND NOT EXISTS (SELECT 1 FROM requests WHERE listing=? AND status IN ('accepted','active','returned','completion_proposed'))", id,user.id,id);
    if (!result.changes) fail(409,'Finish or cancel the active booking before unpublishing.');
    return { ok: true };
  }
  if (match?.[1] === 'saved' && ['PUT','DELETE'].includes(method)) {
    if (method === 'PUT') {
      if (!await get('SELECT id FROM listings WHERE id=? AND active=1', id)) fail(404, 'Listing unavailable.');
      await run('INSERT INTO saved VALUES(?,?) ON CONFLICT DO NOTHING', user.id, id);
    } else await run('DELETE FROM saved WHERE "user"=? AND listing=?', user.id, id);
    return { ok: true };
  }
  if (match?.[1] === 'requests') {
    if (method === 'PUT' && !match[3]) {
      const listing = await get('SELECT owner,kind,item_value_minor FROM listings WHERE id=? AND active=1', id);
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
      await run('INSERT INTO requests(listing,requester,start_date,end_date,details,is_gear) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING', id,user.id,start,end,details,listing.kind === 'gear' ? 1 : 0);
      return await get('SELECT id FROM requests WHERE listing=? AND requester=?', id, user.id);
    }
    const thread = await get(threads + ' WHERE r.id=? AND (r.requester=? OR l.owner=?)', id, user.id, user.id);
    if (!thread) fail(404, 'Conversation unavailable.');
    if (match[3] === 'audit' && method === 'GET') return await all('SELECT actor_user_id,old_status,new_status,occurred_at FROM booking_status_audit WHERE booking=? ORDER BY id',id);
    if (match[3] === 'messages' && method === 'GET') return (await all('SELECT id,sender,body,sent FROM messages WHERE request=? ORDER BY id DESC LIMIT 200', id)).reverse();
    if (match[3] === 'messages' && method === 'POST') {
      await run('INSERT INTO messages(request,sender,body) VALUES(?,?,?)', id, user.id, field(await json(req), 'message', 2000));
      return { ok: true };
    }
    if (match[3] === 'checkout') {
      const days = thread.kind === 'gear' && thread.start_date && thread.end_date
        ? Math.round((Date.parse(thread.end_date) - Date.parse(thread.start_date)) / 86400000) + 1 : 1;
      const amount = Math.round(Number(thread.agreed_price) * 100) * days;
      const existing = await get('SELECT * FROM demo_payments WHERE booking=?', id);
      if (method === 'GET') return { mode:'demo', amount, currency:'INR', days, status:existing?.status || 'unpaid' };
      if (method === 'POST') {
        if (thread.requester !== user.id) fail(403,'Only the customer can use checkout.');
        if (thread.status !== 'accepted' || thread.agreed_price == null || !Number.isSafeInteger(amount)) fail(409,'Checkout requires an accepted booking.');
        const { outcome } = await json(req);
        if (!['succeeded','failed'].includes(outcome)) fail(400,'Choose a demo payment outcome.');
        await run("INSERT INTO demo_payments(booking,amount,currency,status,updated) VALUES(?,?,'INR',?,?) ON CONFLICT(booking) DO UPDATE SET status=excluded.status,updated=excluded.updated WHERE demo_payments.status <> 'succeeded'", id,amount,outcome,new Date().toISOString());
        return await get('SELECT * FROM demo_payments WHERE booking=?',id);
      }
    }
    if (match[3] === 'rating' && method === 'POST') {
      if (thread.requester !== user.id || thread.status !== 'completed') fail(403, 'Only the customer can review a completed booking.');
      const body = await json(req);
      if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) fail(400, 'Choose a rating from 1 to 5.');
      const result = await run('INSERT INTO ratings(booking,score,comment) VALUES(?,?,?) ON CONFLICT DO NOTHING', id,body.score,field(body,'comment',500,false));
      if (!result.changes) fail(409, 'You already reviewed this booking.');
      return { ok: true };
    }
    if (method === 'PATCH' && !match[3]) {
      const { status } = await json(req);
      const owner = user.id === thread.owner;
      const transitions = {
        pending: owner ? ['accepted','declined'] : ['cancelled'],
        accepted: owner ? [thread.kind === 'gear' ? 'active' : 'completion_proposed','cancelled'] : ['cancelled'],
        active: owner ? [] : ['returned'],
        returned: owner ? ['completed'] : [],
        completion_proposed: owner ? [] : ['completed']
      };
      const allowed = transitions[thread.status] || [];
      if (!allowed.includes(status)) fail(409, 'This request cannot change to that status.');
      const booking = status === 'accepted' && thread.kind === 'gear' && thread.start_date;
      const overlap = " AND NOT EXISTS (SELECT 1 FROM requests booked WHERE booked.listing=? AND booked.id<>? AND booked.status IN ('accepted','active','returned','completed') AND booked.start_date<=? AND booked.end_date>=?)";
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
          const result = await tx('UPDATE requests SET ' + assignments.join(', ') + ' WHERE id=? AND status=?' + (booking ? overlap : ''),
            ...values,id,thread.status,...(booking ? [thread.listing,id,thread.end_date,thread.start_date] : []));
          if (!result.changes) fail(409, booking ? 'These rental dates are already booked or the request changed.' : 'Request changed. Refresh and try again.');
          await tx('INSERT INTO booking_status_audit(booking,actor_user_id,old_status,new_status,occurred_at,metadata) VALUES(?,?,?,?,?,?)',
            id,user.id,thread.status,status,new Date().toISOString(),'{}');
        });
      } catch (error) {
        if (error.code === '23P01') fail(409,'These rental dates are already booked.');
        throw error;
      }
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

createServer(async (req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const frameAncestors = ['/landing.html','/borrow.html'].includes(path) ? "'self'" : "'none'";
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' https://api.bigdatacloud.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; frame-src 'self'; frame-ancestors " + frameAncestors + "; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  try {
    const viewer = ['/', '/login', '/profile', '/landing.html', '/borrow.html'].includes(path) ? await sessionUser(req) : null;
    const protectedPages=['/','/profile','/landing.html','/borrow.html'];
    if (req.method === 'GET' && protectedPages.includes(path) && !viewer) {
      res.writeHead(302, { Location:'/login' }).end();
    } else if (req.method === 'GET' && path === '/login' && viewer) {
      res.writeHead(302, { Location:viewer.emailVerified ? '/' : '/verify-email' }).end();
    } else if (req.method === 'GET' && protectedPages.includes(path) && viewer && !viewer.emailVerified) {
      res.writeHead(302, { Location:'/verify-email' }).end();
    } else if (req.method === 'GET' && protectedPages.includes(path) && path !== '/profile' && viewer && !viewer.profileComplete) {
      res.writeHead(302, { Location:'/profile' }).end();
    } else if (req.method === 'GET' && path === '/profile' && viewer?.profileComplete) {
      res.writeHead(302, { Location:'/' }).end();
    } else if (path.startsWith('/api/v1/')) {
      const data = await api(req,res,path.slice(7));
      if (data?.binary) res.writeHead(200,{'Content-Type':data.contentType,'Content-Disposition':'inline','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data.bytes);
      else res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
    } else if (req.method === 'GET' && assets.has(path)) {
      const [file, mime] = assets.get(path);
      res.writeHead(200, {'Content-Type':mime.startsWith('image/') ? mime : mime + '; charset=utf-8'}).end(readFileSync(new URL(file,import.meta.url)));
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
