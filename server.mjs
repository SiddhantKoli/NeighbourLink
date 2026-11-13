import { createServer } from 'node:http';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase } from './database.mjs';

const query = await openDatabase();
const secure = process.env.COOKIE_SECURE === '1';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const all = async (sql, ...args) => (await query(sql, args)).rows;
const get = async (sql, ...args) => (await all(sql, ...args))[0];
const run = async (sql, ...args) => query(sql, args);
const listings = 'SELECT l.id,l.owner,l.kind,l.title,l.category,l.price,l.area,l.description,l.active,(l.photo IS NOT NULL) AS hasPhoto,u.name FROM listings l JOIN users u ON u.id=l.owner';
const threads = 'SELECT r.*,l.title,l.owner,l.kind,u.name AS "requesterName",o.name AS "ownerName" FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=r.requester JOIN users o ON o.id=l.owner';
const assets = new Map([['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/app.css',['app.css','text/css']]]);
for (const name of ['camera','tent','bicycle']) {
  assets.set('/examples/' + name + '.jpg', ['photos/' + name + '.jpg','image/jpeg']);
}
const attempts = new Map();
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function throttle(key) {
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
  const entry = attempts.get(key) || { count: 0, until: now + 600000 };
  attempts.set(key, entry);
  if (++entry.count > 20) fail(429, 'Too many attempts. Try again in 10 minutes.');
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
async function api(req, res, path) {
  const method = req.method;
  const token = req.headers.cookie?.match(/(?:^|; )nl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const user = token && await get('SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s."user" WHERE token=? AND expires>?', digest(token), Date.now());
  const admin = Boolean(user && process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase());
  if (method !== 'GET') {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied.');
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_ORIGIN || 'http://' + req.headers.host;
    if (origin && origin !== expected) fail(403, 'Unexpected request origin.');
  }
  if (method === 'GET' && path === '/session') return user ? { id: user.id, name: user.name, admin } : null;
  if (method === 'GET' && path === '/listings') return await all(listings + ' WHERE l.active=1 ORDER BY l.id DESC');
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
    if (token) await run('DELETE FROM sessions WHERE token=?', digest(token));
    await session(res, account.id);
    return { ok: true };
  }
  if (!user) fail(401, 'Sign in to continue.');
  if (method === 'POST' && path === '/logout') {
    await run('DELETE FROM sessions WHERE token=?', digest(token));
    cookie(res, '', 0);
    return { ok: true };
  }
  if (method === 'GET' && path === '/activity') return {
    listings: await all(listings + ' WHERE l.owner=? ORDER BY l.id DESC', user.id),
    saved: (await all('SELECT listing FROM saved WHERE "user"=?', user.id)).map(row => row.listing),
    threads: await all(threads + ' WHERE r.requester=? OR l.owner=? ORDER BY r.id DESC', user.id, user.id),
    reports: admin ? await all('SELECT reports.*,listings.title FROM reports JOIN listings ON listings.id=reports.listing WHERE reports.status=?', 'open') : []
  };
  const match = path.match(/^\/(listings|saved|requests|reports)\/(\d+)(?:\/(messages))?$/);
  const id = match && Number(match[2]);
  if (method === 'POST' && path === '/listings') {
    const body = await json(req);
    const kind = field(body, 'kind', 4);
    const category = field(body, 'category', 20);
    const categories = { gear: ['Tools','Tech & Camera','Outdoors'], help: ['Home repair','Creative','Lessons'] };
    if (!categories[kind]?.includes(category) || !Number.isInteger(body.price) || body.price < 0 || body.price > 10000000) fail(400, 'Choose a category and enter a valid whole-rupee price.');
    const photo = field(body, 'photo', 1400000, false);
    if (photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) fail(400, 'Use a JPEG, PNG, or WebP photo.');
    return { id: (await get('INSERT INTO listings(owner,kind,title,category,price,area,description,photo) VALUES(?,?,?,?,?,?,?,?) RETURNING id', user.id,kind,field(body,'title',100),category,body.price,field(body,'area',100),field(body,'description',1200),photo || null)).id };
  }
  if (match?.[1] === 'listings' && method === 'DELETE') {
    if (!(await run('UPDATE listings SET active=0 WHERE id=? AND owner=?', id, user.id)).changes) fail(404, 'Listing unavailable.');
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
      const listing = await get('SELECT owner,kind FROM listings WHERE id=? AND active=1', id);
      if (!listing) fail(404, 'Listing unavailable.');
      if (listing.owner === user.id) fail(400, 'You own this listing.');
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
    if (match[3] && method === 'GET') return (await all('SELECT id,sender,body,sent FROM messages WHERE request=? ORDER BY id DESC LIMIT 200', id)).reverse();
    if (match[3] && method === 'POST') {
      await run('INSERT INTO messages(request,sender,body) VALUES(?,?,?)', id, user.id, field(await json(req), 'message', 2000));
      return { ok: true };
    }
    if (method === 'PATCH' && !match[3]) {
      const { status } = await json(req);
      const owner = user.id === thread.owner;
      const allowed = thread.status === 'pending' ? (owner ? ['accepted','declined'] : ['cancelled']) : thread.status === 'accepted' ? (owner ? ['completed','cancelled'] : ['cancelled']) : [];
      if (!allowed.includes(status)) fail(409, 'This request cannot change to that status.');
      const booking = status === 'accepted' && thread.kind === 'gear' && thread.start_date;
      const overlap = " AND NOT EXISTS (SELECT 1 FROM requests booked WHERE booked.listing=? AND booked.id<>? AND booked.status IN ('accepted','completed') AND booked.start_date<=? AND booked.end_date>=?)";
      try {
        const result = await run('UPDATE requests SET status=? WHERE id=? AND status=?' + (booking ? overlap : ''),
          status,id,thread.status,...(booking ? [thread.listing,id,thread.end_date,thread.start_date] : []));
        if (!result.changes) fail(409, booking ? 'These rental dates are already booked or the request changed.' : 'Request changed. Refresh and try again.');
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

createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/v1/')) {
      const data = await api(req,res,path.slice(7));
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
    } else if (req.method === 'GET' && assets.has(path)) {
      const [file, mime] = assets.get(path);
      res.writeHead(200, {'Content-Type':mime.startsWith('image/') ? mime : mime + '; charset=utf-8'}).end(readFileSync(new URL(file,import.meta.url)));
    } else if (req.method === 'GET' && /^\/photos\/\d+$/.test(path)) {
      const photo = (await get('SELECT photo FROM listings WHERE id=? AND active=1', Number(path.slice(8))))?.photo;
      if (!photo) fail(404,'Photo unavailable.');
      const [format, body] = photo.split(';base64,');
      res.writeHead(200, {'Content-Type':format.slice(5)}).end(Buffer.from(body,'base64'));
    } else fail(404,'Page unavailable.');
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) res.writeHead(error.status || 500, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ error: error.status ? error.message : 'Something went wrong. Please try again.' }));
  }
}).listen(Number(process.env.PORT || 8767), process.env.HOST || '127.0.0.1', function () {
  console.log('NeighbourLink listening on port ' + this.address().port);
});



