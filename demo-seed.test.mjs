import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('demo seed is gated, repeatable, and reset preserves real rows',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'neighbourlink-demo-'));
  const env={...process.env,DATABASE_URL:'',DB_PATH:path.join(directory,'marketplace.sqlite'),OBJECT_STORAGE_MODE:'local',OBJECT_STORAGE_DIR:path.join(directory,'images'),DEMO_SEED:'1',DEMO_PASSWORD:'test-only-strong-demo-password',NODE_ENV:'development'};
  const command=(args,environment=env)=>spawnSync(process.execPath,['scripts/demo-seed.mjs',...args],{cwd:process.cwd(),env:environment,encoding:'utf8',timeout:30000});
  let db;
  try{
    assert.notEqual(command([],{...env,DEMO_SEED:'0'}).status,0);
    assert.notEqual(command([],{...env,NODE_ENV:'production'}).status,0);
    let result=command([]);assert.equal(result.status,0,result.stderr);
    db=new DatabaseSync(env.DB_PATH);
    const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE is_demo=1`).get().n;
    assert.equal(count('users'),40);assert.equal(count('listings'),100);
    assert.ok(count('requests')>=75);assert.ok(count('messages')>=225);
    assert.equal(count('reports'),4);assert.ok(count('demo_listing_photos')>=90);
    const statuses=db.prepare('SELECT status,COUNT(*) AS n FROM requests WHERE is_demo=1 GROUP BY status').all();
    for(const status of ['pending','accepted','active','returned','completed','declined','cancelled'])assert.ok(statuses.some(row=>row.status===status&&row.n>0),status);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=l.owner WHERE u.email='demo.owner@neighbourlink.test' AND r.status='pending'").get().n>0);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=l.owner WHERE u.email='demo.provider@neighbourlink.test' AND r.status='pending'").get().n>0);
    const server=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...env,PORT:'0',HOST:'127.0.0.1',PAYMENT_PROVIDER:''},stdio:['ignore','pipe','pipe']});
    try{
      const [output]=await once(server.stdout,'data');const origin='http://127.0.0.1:'+String(output).trim().split(' ').at(-1);
      const login=await fetch(origin+'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'demo.renter@neighbourlink.test',password:env.DEMO_PASSWORD})});
      assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];
      const request=async(path,method='GET',body)=>fetch(origin+'/api/v1'+path,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      const activity=await (await request('/activity')).json();const sample=activity.threads.find(row=>row.is_demo===1&&row.status==='active');
      assert.ok(sample,'Demo renter should see a labelled active sample booking');
      assert.equal((await request('/requests/'+sample.id+'/messages')).status,200);
      assert.equal((await request('/requests/'+sample.id+'/messages','POST',{message:'Try to change sample'})).status,409);
      assert.equal((await request('/requests/'+sample.id,'PATCH',{status:'cancelled'})).status,409);
      assert.equal((await request('/requests/'+sample.id+'/checkout')).status,409);
    }finally{server.kill();}
    const first=count('requests');result=command([]);assert.equal(result.status,0,result.stderr);assert.equal(count('requests'),first);
    db.prepare("INSERT INTO users(name,email,is_demo) VALUES('Real Member','real@example.test',0)").run();
    db.prepare("INSERT INTO listings(owner,kind,title,category,price,area,description,active,is_demo) VALUES((SELECT id FROM users WHERE email='real@example.test'),'gear','Real Drill','Tools',200,'Domlur','Real listing',1,0)").run();
    db.prepare("INSERT INTO requests(listing,requester,status,start_date,end_date,is_demo) VALUES((SELECT id FROM listings WHERE is_demo=1 LIMIT 1),(SELECT id FROM users WHERE email='real@example.test'),'pending','2099-01-01','2099-01-02',0)").run();
    result=command(['--reset']);assert.notEqual(result.status,0,'Reset must refuse cross-boundary bookings');
    assert.match(result.stderr,/Demo reset refused: requests has activity linked to demo data/);
    assert.equal(count('users'),40,'Refused reset must leave demo data intact');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM requests r LEFT JOIN listings l ON l.id=r.listing WHERE r.is_demo=0 AND l.id IS NULL").get().n,0);
    db.prepare("DELETE FROM requests WHERE is_demo=0 AND requester=(SELECT id FROM users WHERE email='real@example.test')").run();
    result=command(['--reset']);assert.equal(result.status,0,result.stderr);
    for(const table of ['users','listings','requests','messages','saved','ratings','reports','demo_listing_photos']) assert.equal(count(table),0,table);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email='real@example.test'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listings WHERE title='Real Drill'").get().n,1);
  }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});
