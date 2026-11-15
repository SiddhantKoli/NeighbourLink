import {scryptSync,createHash} from 'node:crypto';
import {openDatabase} from '../database.mjs';
import {createObjectStorage} from '../storage.mjs';

if(process.env.DEMO_SEED!=='1'||process.env.NODE_ENV==='production') throw Error('Demo seeding requires DEMO_SEED=1 and a non-production NODE_ENV.');
const password=process.env.DEMO_PASSWORD||'';
if(!process.argv.includes('--reset')&&password.length<16) throw Error('Set DEMO_PASSWORD to a strong password of at least 16 characters.');
const db=await openDatabase(),storage=await createObjectStorage();
const rows=async(sql,...args)=>(await db(sql,...args)).rows;
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=(()=>{let n=1752026;return()=>((n=Math.imul(1664525,n)+1013904223|0)>>>0)/4294967296})();
const pick=list=>list[Math.floor(random()*list.length)];
const areas=[['Indiranagar',12.98,77.64],['Koramangala',12.94,77.62],['Domlur',12.96,77.64],['HSR Layout',12.91,77.64],['BTM Layout',12.92,77.61],['Jayanagar',12.93,77.58],['Whitefield',12.97,77.75],['Marathahalli',12.96,77.70],['Malleshwaram',13.00,77.57],['Hebbal',13.04,77.59]];
const names=['Aarav Shah','Meera Iyer','Kabir Nair','Ananya Rao','Riya Menon','Arjun Kulkarni','Sneha Patil','Ishaan Reddy','Priya Sharma','Rohan Gupta','Aditi Joshi','Varun Sinha','Neha Bhat','Dev Malhotra','Kavya Pillai','Rahul Shetty','Tanvi Desai','Nikhil Verma','Pooja Krishnan','Aman Khan','Sanya Kapoor','Vivek Mishra','Diya Hegde','Sahil Jain','Nisha Fernandes','Karan Mehta','Swati Das','Aditya Bansal','Tara Thomas','Manav Singh','Fatima Ali','Harish Rao','Leena Nair','Yash Patel','Sonia Dsouza','Vikram Sethi','Maya Prasad','Farhan Siddiqui','Ira Chatterjee','Omkar Jadhav'];
const gear=[['Cordless drill','Tools',350],['Hammer drill','Tools',500],['Extension ladder','Tools',450],['Pressure washer','Tools',850],['Toolbox and spanners','Tools',250],['Circular saw','Tools',700],['DSLR camera kit','Tech & Camera',1400],['Mirrorless camera','Tech & Camera',1900],['GoPro camera','Tech & Camera',900],['Camera tripod','Tech & Camera',250],['Home projector','Tech & Camera',1100],['Bluetooth speaker','Tech & Camera',350],['Party lights','Tech & Camera',400],['Laptop','Tech & Camera',1200],['Two-person tent','Outdoors',550],['Sleeping bag','Outdoors',250],['Trekking poles','Outdoors',180],['Camping stove','Outdoors',300],['City bicycle','Outdoors',400],['Scooter helmet','Outdoors',150]];
const help=[['Plumbing repair','Home repair',600],['Electrical repair','Home repair',650],['AC service','Home repair',900],['Carpentry visit','Home repair',800],['Room painting','Home repair',1800],['Appliance repair','Home repair',700],['Event photographer','Creative',2500],['Video editing','Creative',1800],['Mehendi artist','Creative',1200],['Portrait photography','Creative',2000],['Guitar lesson','Lessons',500],['Maths tutoring','Lessons',450],['Yoga session','Lessons',600],['Home cooking lesson','Lessons',950],['Tailoring lesson','Lessons',550]];
const svg=(label,accent,initials=false)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${accent}"/><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#0b0b0b" opacity=".28"/></pattern><rect width="640" height="480" fill="url(#dots)"/><rect x="38" y="38" width="564" height="404" fill="none" stroke="#0b0b0b" stroke-width="8"/><text x="70" y="258" font-family="Arial,sans-serif" font-size="${initials?122:46}" font-weight="800" fill="#0b0b0b">${label.replaceAll('&','&amp;')}</text><text x="70" y="385" font-family="monospace" font-size="20" fill="#0b0b0b">NEIGHBOURLINK · DEMO</text></svg>`);
const key=(kind,id,n=0)=>`demo/${kind}/${id}/${n}.svg`;
async function reset(){
  const media=[...await rows('SELECT profile_photo_key AS storage_key FROM users WHERE is_demo=1'),...await rows('SELECT photo_key AS storage_key FROM listings WHERE is_demo=1'),...await rows('SELECT storage_key FROM demo_listing_photos WHERE is_demo=1')].map(x=>x.storage_key).filter(Boolean);
  await db.transaction(async tx=>{
    const references=[
      ['listings',"is_demo=0 AND owner IN (SELECT id FROM users WHERE is_demo=1)"],
      ['requests',"is_demo=0 AND (listing IN (SELECT id FROM listings WHERE is_demo=1) OR requester IN (SELECT id FROM users WHERE is_demo=1))"],
      ['messages',"is_demo=0 AND (request IN (SELECT id FROM requests WHERE is_demo=1) OR sender IN (SELECT id FROM users WHERE is_demo=1))"],
      ['saved',"is_demo=0 AND (listing IN (SELECT id FROM listings WHERE is_demo=1) OR \"user\" IN (SELECT id FROM users WHERE is_demo=1))"],
      ['ratings',"is_demo=0 AND booking IN (SELECT id FROM requests WHERE is_demo=1)"],
      ['reports',"is_demo=0 AND (listing IN (SELECT id FROM listings WHERE is_demo=1) OR reporter IN (SELECT id FROM users WHERE is_demo=1))"],
      ['uploads',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['listing_availability_blocks',"listing IN (SELECT id FROM listings WHERE is_demo=1)"],
      ['booking_status_audit',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR actor_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['money_ledger',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR actor_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['protected_payments',"booking IN (SELECT id FROM requests WHERE is_demo=1)"],
      ['booking_evidence',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR uploader_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['booking_ratings',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR rater_user_id IN (SELECT id FROM users WHERE is_demo=1) OR ratee_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['booking_late_fees',"booking IN (SELECT id FROM requests WHERE is_demo=1)"],
      ['booking_claims',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR owner_user_id IN (SELECT id FROM users WHERE is_demo=1) OR resolver_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['booking_claim_audit',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR actor_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['booking_claim_evidence',"booking IN (SELECT id FROM requests WHERE is_demo=1) OR uploader_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['demo_payments',"booking IN (SELECT id FROM requests WHERE is_demo=1)"],
      ['owner_payment_accounts',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['kyc_cases',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['kyc_access_audit',"subject_user_id IN (SELECT id FROM users WHERE is_demo=1) OR reviewer_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['kyc_review_audit',"subject_user_id IN (SELECT id FROM users WHERE is_demo=1) OR actor_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['phone_otp_challenges',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['email_verification_tokens',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['password_reset_tokens',"user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['business_accounts',"owner_user_id IN (SELECT id FROM users WHERE is_demo=1) OR reviewer_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['business_members',"user_id IN (SELECT id FROM users WHERE is_demo=1) OR invited_by IN (SELECT id FROM users WHERE is_demo=1)"],
      ['business_member_audit',"actor_user_id IN (SELECT id FROM users WHERE is_demo=1) OR subject_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['business_verification_audit',"actor_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['business_document_access_audit',"reviewer_user_id IN (SELECT id FROM users WHERE is_demo=1)"],
      ['shop_member_invites',"invitee_user_id IN (SELECT id FROM users WHERE is_demo=1) OR invited_by IN (SELECT id FROM users WHERE is_demo=1)"],
      ['notification_outbox',"recipient_email IN (SELECT email FROM users WHERE is_demo=1)"],
    ];
    if(process.env.DATABASE_URL) await tx.exec('LOCK TABLE '+[...new Set([...references.map(([table])=>table),'users','demo_listing_photos','sessions'])].join(', ')+' IN SHARE ROW EXCLUSIVE MODE');
    for(const [table,condition] of references){
      if((await tx(`SELECT 1 FROM ${table} WHERE ${condition} LIMIT 1`)).rows.length) throw Error(`Demo reset refused: ${table} has activity linked to demo data. Preserve that activity or remove it explicitly before resetting.`);
    }
    await tx('DELETE FROM sessions WHERE "user" IN (SELECT id FROM users WHERE is_demo=1)');
    for(const table of ['messages','ratings','saved','reports','requests','demo_listing_photos','listings','users']) await tx(`DELETE FROM ${table} WHERE is_demo=1`);
  });
  for(const objectKey of media) await storage.remove(objectKey);
  console.log('Removed demo rows and artwork; preserved non-demo records.');
}
if(process.argv.includes('--reset')){await reset();process.exit(0);}
if((await rows('SELECT COUNT(*) AS count FROM users WHERE is_demo=1'))[0].count>0){console.log('Demo dataset already exists; no rows added.');process.exit(0);}
const userIds=[],listingIds=[];
const now=new Date(),today=now.toISOString().slice(0,10),date=offset=>new Date(Date.parse(today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
for(let i=0;i<40;i++){
  const area=areas[i%areas.length],name=names[i],email=i<4?`demo.${['renter','owner','provider','admin'][i]}@neighbourlink.test`:`demo.neighbour${String(i+1).padStart(2,'0')}@neighbourlink.test`;
  const salt=digest('demo-salt-'+i).slice(0,32),photoKey=key('avatars',i);
  const result=await db('INSERT INTO users(name,email,salt,password,phone,profile_photo_key,email_verified_at,phone_verified_at,is_demo) VALUES(?,?,?,?,?,?,?,?,1) RETURNING id',name,email,salt,scryptSync(password,salt,64).toString('hex'),'+9198'+String(10000000+i).padStart(8,'0'),photoKey,now.toISOString(),now.toISOString());
  userIds.push(result.rows[0].id);
  await storage.put(photoKey,svg(name.split(' ').map(s=>s[0]).join(''),i%2?'#fdb900':'#00edb0',true),'image/svg+xml');
}
for(let i=0;i<100;i++){
  const isGear=i<60,spec=isGear?gear[i%gear.length]:help[(i-60)%help.length],area=areas[(i*7)%areas.length],owner=userIds[isGear?(i<3?1:4+i%36):(i===60?2:4+i%36)],photoKey=key('listings',i);
  const title=spec[0]+(i>= (isGear?gear.length:60+help.length)?` · ${area[0]}`:'');
  const description=isGear?`Clean, ready to borrow. Includes carrying case and essentials. Condition: checked after each rental; normal signs of use. Pickup near ${area[0]}.`:`Friendly local ${spec[0].toLowerCase()} in ${area[0]}. Clear scope and timing agreed before booking.`;
  const result=await db('INSERT INTO listings(owner,kind,title,category,price,item_value_minor,condition_checklist,area,description,photo_key,latitude,longitude,active,listing_status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,\'published\',1) RETURNING id',owner,isGear?'gear':'help',title,spec[1],Math.min(2500,spec[2]+(i%3)*50),isGear?Math.max(10000,spec[2]*3000):null,isGear?'["Clean and ready","Normal signs of use"]':'[]',area[0]+', Bengaluru',description,photoKey,area[1],area[2]);
  const id=result.rows[0].id;listingIds.push(id);
  await storage.put(photoKey,svg(spec[0],isGear?'#00edb0':'#fdb900'),'image/svg+xml');
  for(let position=1;position<=i%3;position++){
    const extraKey=key('listings',i,position);await storage.put(extraKey,svg(spec[1]+' · '+position,position%2?'#fdb900':'#00edb0'),'image/svg+xml');
    await db('INSERT INTO demo_listing_photos(listing,position,storage_key,is_demo) VALUES(?,?,?,1)',id,position,extraKey);
  }
}
const statuses=['pending','accepted','active','returned','completed','declined','cancelled'];
for(let i=0;i<80;i++){
  const listingIndex=i<3?i:i===3?60:(i*37)%100,listing=listingIds[listingIndex],gearListing=listingIndex<60,owner=userIds[gearListing?(listingIndex<3?1:4+listingIndex%36):(listingIndex===60?2:4+listingIndex%36)];
  let renter=i<3?userIds[0]:userIds[(i*11+7)%40];if(renter===owner)renter=userIds[(i*11+8)%40];
  const status=i===0||i===3?'pending':i===1?'active':i===2?'completed':statuses[i%statuses.length];
  const start=date(status==='completed'?-15+i%4:status==='active'?-1:2+i%18),end=date(status==='completed'?-13+i%4:status==='active'?2:4+i%18);
  const result=await db('INSERT INTO requests(listing,requester,status,start_date,end_date,details,is_gear,accepted_at,completed_at,is_demo) VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING RETURNING id',listing,renter,status,start,end,gearListing?'Could I pick this up in the evening?':'Please let me know an available time.',gearListing?1:0,['accepted','active','returned','completed'].includes(status)?now.toISOString():null,status==='completed'?now.toISOString():null);
  if(!result.rows.length)continue;
  const booking=result.rows[0].id,count=3+i%6;
  const dialog=['Hi, is this available?','Yes, it is available.','Great, what time works for you?','Early evening works well.','Thanks, I will confirm shortly.','Please message when you arrive.','Sure, see you then.','Thank you!'];
  for(let j=0;j<count;j++)await db('INSERT INTO messages(request,sender,body,sent,read_at,is_demo) VALUES(?,?,?,?,?,1)',booking,j%2?renter:owner,dialog[j],new Date(now.getTime()-(count-j)*3600000).toISOString(),j===count-1?null:now.toISOString());
  if(status==='completed'&&i!==2)await db('INSERT INTO ratings(booking,score,comment,is_demo) VALUES(?,?,?,1)',booking,pick([4,5,5,5]),pick(['Easy to coordinate.','Exactly as described.','Friendly and helpful.','Would book again.']));
}
for(let i=0;i<35;i++)await db('INSERT INTO saved("user",listing,is_demo) VALUES(?,?,1) ON CONFLICT DO NOTHING',userIds[i%40],listingIds[(i*13)%100]);
for(let i=0;i<4;i++)await db('INSERT INTO reports(listing,reporter,reason,status,is_demo) VALUES(?,?,?,\'open\',1) ON CONFLICT DO NOTHING',listingIds[20+i],userIds[30+i],'Please review the accuracy of this demo listing.');
console.log('Seeded 40 members, 100 listings, booking threads, saved items, reviews, and reports.');
