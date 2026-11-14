import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('marketplace permissions, requests, messages, and moderation', async t => {
  const child = spawn(process.execPath, ['server.mjs'], {
    env: {...process.env, DATABASE_URL:'', DB_PATH:':memory:', PORT:'0', HOST:'127.0.0.1', NODE_ENV:'test', EMAIL_PROVIDER:'mock', OBJECT_STORAGE_MODE:'memory', ADMIN_EMAIL:'admin@example.test', ADMIN_SIGNUP_CODE:'local-test-code'},
    stdio:['ignore','pipe','inherit']
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout,'data');
  const origin = 'http://127.0.0.1:' + String(output).trim().split(' ').at(-1);
  function client() {
    let cookie = '';
    const request = async (path, expected = 200, method = 'GET', body) => {
      const headers = { cookie };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(origin + '/api/v1' + path, {method,headers,body:body && JSON.stringify(body)});
      cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
      const data = await res.json();
      assert.equal(res.status,expected,JSON.stringify(data));
      return data;
    };
    request.cookie = () => cookie;
    request.upload = async purpose => {
      const bytes=Uint8Array.from([0xff,0xd8,0xff,0xd9]);
      const response=await fetch(origin + '/api/v1/uploads',{method:'POST',headers:{cookie,'Content-Type':'image/jpeg','X-Upload-Purpose':purpose},body:bytes});
      const data=await response.json();
      assert.equal(response.status,200,JSON.stringify(data));
      return data.uploadId;
    };
    request.badUpload = async () => {
      const response=await fetch(origin + '/api/v1/uploads',{method:'POST',headers:{cookie,'Content-Type':'image/jpeg','X-Upload-Purpose':'listing'},body:Uint8Array.from([1,2,3,4])});
      assert.equal(response.status,400);
    };
    return request;
  }
  const owner = client(), borrower = client(), outsider = client(), admin = client();
  for (const path of ['/', '/landing.html', '/borrow.html']) {
    const response = await fetch(origin + path, {redirect:'manual'});
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),'/login');
  }
  assert.equal((await fetch(origin + '/api/v1/listings')).status,401);
  const account = (name, adminCode) => ({name,email:name + '@example.test',password:'sample-test-passphrase',adminCode});
  const verifyEmail = async (request,email) => {
    assert.equal((await request('/__test/mailbox?to=' + encodeURIComponent(email))).length,1);
    await request('/email-verification/resend',200,'POST');
    const messages=await request('/__test/mailbox?to=' + encodeURIComponent(email));
    assert.equal(messages.length,1);
    const url=messages[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(url,'verification email should contain a link');
    const token=new URL(url).searchParams.get('token');
    await request('/verify-email',400,'POST',{token:'invalid-token'});
    await request('/verify-email',200,'POST',{token});
  };
  const completeProfile = async (request,name) => {
    const photoUploadId=await request.upload('profile');
    return request('/profile',200,'PUT',{name,phone:'+919876543210',photoUploadId});
  };
  await owner('/signup',200,'POST',account('owner'));
  assert.equal((await owner('/session')).emailVerified,false);
  await verifyEmail(owner,'owner@example.test');
  await owner('/listings',403);
  await completeProfile(owner,'owner');
  assert.equal((await fetch(origin + '/', {headers:{cookie:owner.cookie()},redirect:'manual'})).status,200);
  assert.equal((await fetch(origin + '/landing.html', {headers:{cookie:owner.cookie()},redirect:'manual'})).status,200);
  assert.equal((await fetch(origin + '/borrow.html', {headers:{cookie:owner.cookie()},redirect:'manual'})).status,200);
  const loginRedirect = await fetch(origin + '/login', {headers:{cookie:owner.cookie()},redirect:'manual'});
  assert.equal(loginRedirect.status,302);
  assert.equal(loginRedirect.headers.get('location'),'/');
  await borrower('/signup',200,'POST',account('borrower'));
  await verifyEmail(borrower,'borrower@example.test');
  await completeProfile(borrower,'borrower');
  await outsider('/signup',200,'POST',account('outsider'));
  await verifyEmail(outsider,'outsider@example.test');
  await completeProfile(outsider,'outsider');
  await admin('/signup',403,'POST',account('admin'));
  await admin('/signup',200,'POST',account('admin','local-test-code'));
  await verifyEmail(admin,'admin@example.test');
  await completeProfile(admin,'admin');
  assert.equal((await admin('/session')).admin,true);
  const listingPhoto=await owner.upload('listing');
  await owner.badUpload();
  const listing = await owner('/listings',200,'POST',{title:'Drill',kind:'gear',category:'Tools',price:200,area:'Bengaluru',description:'Cordless drill',photoUploadId:listingPhoto});
  const photoResponse=await fetch(origin + '/photos/' + listing.id);
  assert.equal(photoResponse.status,200);
  assert.equal(photoResponse.headers.get('content-type'),'image/jpeg');
  assert.equal((await photoResponse.arrayBuffer()).byteLength,4);
  await outsider('/listings/' + listing.id,404,'DELETE');
  await borrower('/saved/' + listing.id,200,'PUT');
  assert.deepEqual((await borrower('/activity')).saved,[listing.id]);
  assert.deepEqual((await owner('/activity')).saved,[]);
  const dates = { startDate:'2099-06-10', endDate:'2099-06-12', details:'Pickup at noon' };
  const request = await borrower('/requests/' + listing.id,200,'PUT',dates);
  assert.deepEqual(await borrower('/requests/' + listing.id,200,'PUT',dates),request);
  const path = '/requests/' + request.id;
  await outsider(path + '/messages',404);
  await borrower(path,409,'PATCH',{status:'accepted'});
  await borrower(path + '/messages',200,'POST',{message:'Can I pick this up Saturday?'});
  assert.equal((await owner(path + '/messages'))[0].body,'Can I pick this up Saturday?');
  await owner(path,200,'PATCH',{status:'accepted'});
  const acceptanceAudit = await owner(path + '/audit');
  assert.equal(acceptanceAudit.length,1);
  assert.equal(acceptanceAudit[0].old_status,'pending');
  assert.equal(acceptanceAudit[0].new_status,'accepted');
  assert.equal(acceptanceAudit[0].actor_user_id,1);
  await outsider(path + '/checkout',404);
  await owner(path + '/checkout',403,'POST',{outcome:'succeeded'});
  await borrower(path + '/checkout',200,'POST',{outcome:'failed'});
  assert.equal((await borrower(path + '/checkout')).status,'failed');
  await borrower(path + '/checkout',200,'POST',{outcome:'succeeded'});
  await borrower(path + '/checkout',200,'POST',{outcome:'failed'});
  const receipt = await borrower(path + '/checkout');
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.amount,60000);
  const competing = await outsider('/requests/' + listing.id,200,'PUT',dates);
  await owner('/requests/' + competing.id,409,'PATCH',{status:'accepted'});
  assert.equal((await borrower('/activity')).threads[0].end_date,dates.endDate);
  const servicePhoto=await owner.upload('listing');
  const service = await owner('/listings',200,'POST',{title:'Piano lesson',kind:'help',category:'Lessons',price:200,area:'Bengaluru',description:'Beginner lessons',photoUploadId:servicePhoto});
  await outsider('/requests/' + service.id,400,'PUT',{startDate:dates.startDate});
  const job = await outsider('/requests/' + service.id,200,'PUT',{startDate:dates.startDate,details:'First lesson'});
  assert.equal((await outsider('/activity')).threads[0].details,'First lesson');
  const jobPath = '/requests/' + job.id;
  await owner(jobPath,200,'PATCH',{status:'accepted'});
  await owner(jobPath,200,'PATCH',{status:'completion_proposed'});
  await owner(jobPath,409,'PATCH',{status:'completed'});
  await outsider(jobPath,200,'PATCH',{status:'completed'});
  await outsider(jobPath + '/rating',200,'POST',{score:4,comment:'Clear explanations'});
  await owner('/listings/' + service.id,200,'DELETE');
  await borrower(path + '/rating',403,'POST',{score:5});
  await owner(path,200,'PATCH',{status:'active'});
  await owner('/listings/' + listing.id,409,'DELETE');
  assert.equal((await borrower('/activity')).threads[0].agreed_price,'200');
  await borrower(path,200,'PATCH',{status:'returned'});
  await owner(path,200,'PATCH',{status:'completed'});
  await borrower(path + '/rating',200,'POST',{score:5});
  await borrower(path + '/rating',409,'POST',{score:5});
  await borrower('/reports/' + listing.id,200,'POST',{reason:'Test report'});
  const [report] = (await admin('/activity')).reports;
  await outsider('/reports/' + report.id,404,'PATCH',{status:'removed'});
  await admin('/reports/' + report.id,200,'PATCH',{status:'removed'});
  assert.deepEqual(await borrower('/listings'),[]);
  await borrower('/logout',200,'POST');
  await borrower('/activity',401);
  assert.equal((await fetch(origin + '/', {headers:{cookie:borrower.cookie()},redirect:'manual'})).status,302);
  await borrower('/password-reset',200,'POST',{email:'borrower@example.test'});
  const [resetMessage]=await borrower('/__test/mailbox?to=borrower%40example.test');
  const resetUrl=resetMessage.text.match(/https?:\/\/\S+/)?.[0];
  const resetToken=new URL(resetUrl).searchParams.get('token');
  await borrower('/password-reset/complete',400,'POST',{token:'invalid-token',password:'sample-new-passphrase'});
  await borrower('/password-reset/complete',200,'POST',{token:resetToken,password:'sample-new-passphrase'});
  await borrower('/password-reset/complete',400,'POST',{token:resetToken,password:'sample-new-passphrase'});
  await borrower('/login',200,'POST',{...account('borrower'),password:'sample-new-passphrase'});
  assert.equal((await fetch(origin + '/', {headers:{cookie:borrower.cookie()},redirect:'manual'})).status,200);
  assert.equal((await borrower('/activity')).threads[0].status,'completed');
  assert.equal((await fetch(origin + '/login')).status,200);
  const page = await fetch(origin);
  assert.match(await page.text(),/view-landing/);
  assert.equal((await fetch(origin + '/app.js')).status,200);
  assert.equal((await owner(path + '/audit')).length,4);
});

test('versioned foundation migrations seed placeholder settings and protect append-only tables', async () => {
  const oldUrl = process.env.DATABASE_URL;
  const oldPath = process.env.DB_PATH;
  delete process.env.DATABASE_URL;
  process.env.DB_PATH = ':memory:';
  try {
    const { openDatabase } = await import('./database.mjs');
    const query = await openDatabase();
    const versions = await query('SELECT version,name FROM schema_migrations ORDER BY version');
    assert.deepEqual(versions.rows.map(row => row.version),[1,2,3]);
    const settings = await query('SELECT setting_key,setting_value FROM marketplace_settings ORDER BY setting_key');
    assert.equal(settings.rows.find(row => row.setting_key === 'claim_window_hours').setting_value,'24');
    await query('INSERT INTO money_ledger(booking,event_type,amount_minor,currency,idempotency_key,metadata,occurred_at) VALUES(1,\'hold\',100,\'INR\',\'test-hold\',\'{}\',?)',new Date().toISOString());
    await assert.rejects(() => query('UPDATE money_ledger SET amount_minor=0 WHERE id=1'),/append-only/);
    await assert.rejects(() => query('DELETE FROM money_ledger WHERE id=1'),/append-only/);
    await query('INSERT INTO booking_status_audit(booking,old_status,new_status,occurred_at) VALUES(1,\'pending\',\'accepted\',?)',new Date().toISOString());
    await assert.rejects(() => query('UPDATE booking_status_audit SET new_status=\'declined\' WHERE id=1'),/append-only/);
  } finally {
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = oldPath;
  }
});

test('SQLite backup command creates a verified, restorable copy', () => {
  const directory=mkdtempSync(path.join(os.tmpdir(),'neighbourlink-backup-'));
  const source=path.join(directory,'source.sqlite');
  const backup=path.join(directory,'backup.sqlite');
  try {
    const db=new DatabaseSync(source);
    db.exec("CREATE TABLE backup_check(value TEXT); INSERT INTO backup_check VALUES('restored');");
    db.close();
    const result=spawnSync(process.execPath,['scripts/sqlite-backup.mjs',backup],{cwd:process.cwd(),env:{...process.env,DB_PATH:source},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const restored=new DatabaseSync(backup,{readOnly:true});
    assert.equal(restored.prepare('SELECT value FROM backup_check').get().value,'restored');
    restored.close();
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
