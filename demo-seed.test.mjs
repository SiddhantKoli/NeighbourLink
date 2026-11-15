import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('demo seed is gated, repeatable, and reset preserves real rows',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'neighbourlink-demo-'));
  const env={...process.env,DATABASE_URL:'',DB_PATH:path.join(directory,'marketplace.sqlite'),OBJECT_STORAGE_MODE:'local',OBJECT_STORAGE_DIR:path.join(directory,'images'),DEMO_SEED:'1',DEMO_PASSWORD:'test-only-strong-demo-password',NODE_ENV:'development'};
  const command=(args,environment=env)=>spawnSync(process.execPath,['scripts/demo-seed.mjs',...args],{cwd:process.cwd(),env:environment,encoding:'utf8',timeout:30000});
  try{
    assert.notEqual(command([],{...env,DEMO_SEED:'0'}).status,0);
    assert.notEqual(command([],{...env,NODE_ENV:'production'}).status,0);
    let result=command([]);assert.equal(result.status,0,result.stderr);
    const db=new DatabaseSync(env.DB_PATH);
    const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE is_demo=1`).get().n;
    assert.equal(count('users'),40);assert.equal(count('listings'),100);
    assert.ok(count('requests')>=75);assert.ok(count('messages')>=225);
    assert.equal(count('reports'),4);assert.ok(count('demo_listing_photos')>=90);
    const statuses=db.prepare('SELECT status,COUNT(*) AS n FROM requests WHERE is_demo=1 GROUP BY status').all();
    for(const status of ['pending','accepted','active','returned','completed','declined','cancelled'])assert.ok(statuses.some(row=>row.status===status&&row.n>0),status);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=l.owner WHERE u.email='demo.owner@neighbourlink.test' AND r.status='pending'").get().n>0);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN listings l ON l.id=r.listing JOIN users u ON u.id=l.owner WHERE u.email='demo.provider@neighbourlink.test' AND r.status='pending'").get().n>0);
    const first=count('requests');result=command([]);assert.equal(result.status,0,result.stderr);assert.equal(count('requests'),first);
    db.prepare("INSERT INTO users(name,email,is_demo) VALUES('Real Member','real@example.test',0)").run();
    db.prepare("INSERT INTO listings(owner,kind,title,category,price,area,description,active,is_demo) VALUES((SELECT id FROM users WHERE email='real@example.test'),'gear','Real Drill','Tools',200,'Domlur','Real listing',1,0)").run();
    result=command(['--reset']);assert.equal(result.status,0,result.stderr);
    for(const table of ['users','listings','requests','messages','saved','ratings','reports','demo_listing_photos']) assert.equal(count(table),0,table);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email='real@example.test'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listings WHERE title='Real Drill'").get().n,1);
    db.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
