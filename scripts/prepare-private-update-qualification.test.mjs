import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qualificationSources } from './prepare-private-update-qualification.mjs';
test('private probe appends a migration without modifying shipped migration bodies',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const migration=read('crates/rstorrent-session/src/store_migration.rs');
 const schema=read('crates/rstorrent-session/src/store_schema.rs');
 const generator=read('scripts/desktop-compatibility.mjs');
 const automatic=read('clients/desktop/src-tauri/src/automatic_updates.rs');
 const out=qualificationSources(migration,schema,generator,automatic);
 assert(out.schema.includes('const SCHEMA_VERSION: i64 = 30;'));
 assert(out.migration.includes('fn migrate_29_to_30'));
 const oldBody=migration.slice(migration.indexOf('fn migrate_26_to_27'),migration.indexOf('const NETWORK_DEFAULTS_COLUMN_28'));
 assert(out.migration.includes(oldBody));
 assert(out.automatic.includes('let cadence = if channel == ChannelId::Latest'));
 assert(out.generator.includes("[30, item(session, 'migrate_29_to_30')]"));
 assert.throws(()=>qualificationSources(migration.replace('migrate_28_to_29];','different];'),schema,generator,automatic));
});

test('private CLI generates schema 30 facts and preserves every real migration prefix',async()=>{
 const {mkdtempSync,mkdirSync,copyFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const root=new URL('..',import.meta.url).pathname,temp=mkdtempSync(join(tmpdir(),'jstorrent-private-probe-'));
 const files=['scripts/prepare-private-update-qualification.mjs','scripts/desktop-compatibility.mjs','distribution/desktop-compatibility.json',
 'crates/rstorrent-session/src/store_migration.rs','crates/rstorrent-session/src/store_schema.rs','crates/rstorrent-session/src/product_state.rs','crates/rstorrent-session/src/speed.rs','crates/rstorrent-session/src/store/file_state.rs','crates/rstorrent-session/src/store/safety.rs','clients/desktop/src-tauri/src/automatic_updates.rs','crates/rstorrent-session/tests/fixtures/catalog/v26.sqlite','crates/rstorrent-session/tests/fixtures/product/v2.sqlite'];
 try{
  for(const file of files){mkdirSync(dirname(join(temp,file)),{recursive:true});copyFileSync(join(root,file),join(temp,file));}
  const helper=join(temp,'scripts/prepare-private-update-qualification.mjs');
  assert.throws(()=>execFileSync(process.execPath,[helper],{env:{...process.env,JSTORRENT_PRIVATE_UPDATE_QUALIFICATION:'false'},stdio:'pipe'}));
  const before=JSON.parse(readFileSync(join(temp,'distribution/desktop-compatibility.json'),'utf8'));
  execFileSync(process.execPath,[helper],{env:{...process.env,JSTORRENT_PRIVATE_UPDATE_QUALIFICATION:'true'},stdio:'pipe'});
  const after=JSON.parse(readFileSync(join(temp,'distribution/desktop-compatibility.json'),'utf8'));
  assert.equal(after.stores.session.target,30);
  for(const [version,digest]of Object.entries(before.stores.session.lineage))assert.equal(after.stores.session.lineage[version],digest);
  const receipt=JSON.parse(readFileSync(join(temp,'distribution/private-update-qualification.json'),'utf8'));
  assert.equal(receipt.privateQualification,true);assert.equal(receipt.stableEnabled,true);assert.equal(Object.keys(receipt.files).length,4);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
