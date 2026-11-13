import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('marketplace permissions, requests, messages, and moderation', async t => {
  const child = spawn(process.execPath, ['server.mjs'], {
    env: {...process.env, DATABASE_URL:'', DB_PATH:':memory:', PORT:'0', HOST:'127.0.0.1', ADMIN_EMAIL:'admin@example.test', ADMIN_SIGNUP_CODE:'local-test-code'},
    stdio:['ignore','pipe','inherit']
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout,'data');
  const origin = 'http://127.0.0.1:' + String(output).trim().split(' ').at(-1);
  function client() {
    let cookie = '';
    return async (path, expected = 200, method = 'GET', body) => {
      const headers = { cookie };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(origin + '/api/v1' + path, {method,headers,body:body && JSON.stringify(body)});
      cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
      const data = await res.json();
      assert.equal(res.status,expected,JSON.stringify(data));
      return data;
    };
  }
  const owner = client(), borrower = client(), outsider = client(), admin = client();
  const account = (name, adminCode) => ({name,email:name + '@example.test',password:'sample-test-passphrase',adminCode});
  await owner('/signup',200,'POST',account('owner'));
  await borrower('/signup',200,'POST',account('borrower'));
  await outsider('/signup',200,'POST',account('outsider'));
  await admin('/signup',403,'POST',account('admin'));
  await admin('/signup',200,'POST',account('admin','local-test-code'));
  assert.equal((await admin('/session')).admin,true);
  const listing = await owner('/listings',200,'POST',{title:'Drill',kind:'gear',category:'Tools',price:200,area:'Bengaluru',description:'Cordless drill'});
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
  const competing = await outsider('/requests/' + listing.id,200,'PUT',dates);
  await owner('/requests/' + competing.id,409,'PATCH',{status:'accepted'});
  assert.equal((await borrower('/activity')).threads[0].end_date,dates.endDate);
  const service = await owner('/listings',200,'POST',{title:'Piano lesson',kind:'help',category:'Lessons',price:200,area:'Bengaluru',description:'Beginner lessons'});
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
  await borrower('/login',200,'POST',account('borrower'));
  assert.equal((await borrower('/activity')).threads[0].status,'completed');
  assert.equal((await fetch(origin + '/login')).status,200);
  const page = await fetch(origin);
  assert.match(await page.text(),/view-landing/);
  assert.equal((await fetch(origin + '/app.js')).status,200);
});
