import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDesktopVersion, assertNewDesktopVersion } from './desktop-release-train.mjs';
import { assertForwardCompatibility, databaseCompatibility } from './desktop-compatibility.mjs';
const release=(version)=>({tag_name:version,assets:[{name:'JSTorrent_x64.app.tar.gz'}]});
test('one numeric train spans both channels and ignores frozen identities',()=>{
 const releases=[release('desktop-v0.3.5'),release('desktop-latest-v0.3.8'),{tag_name:'desktop-latest-v0.9.900',assets:[]}];
 assert.equal(nextDesktopVersion('0.3.1',releases),'0.3.9');
 assert.throws(()=>assertNewDesktopVersion('0.3.8',releases),/advance/);
 assert.throws(()=>assertNewDesktopVersion('0.3.6',releases),/advance/);
 assertNewDesktopVersion('0.3.9',releases);
 assert.equal(nextDesktopVersion('0.3.65535',[]),'0.4.0');
 assert.throws(()=>nextDesktopVersion('255.255.65535',[]),/bounds/);
});
test('publication CLI reads paginated JSON without incompatible GitHub CLI flags',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,delimiter}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const temp=mkdtempSync(join(tmpdir(),'jstorrent-release-api-'));
 try {
  writeFileSync(join(temp,'gh'), '#!/usr/bin/env node\nconst args=process.argv.slice(2);\nif(args.includes("--slurp") && args.includes("--jq")) throw new Error("slurp does not support jq");\nif(!args.includes("--paginate") || !args.includes("--slurp")) throw new Error("all pages required");\nprocess.stdout.write("[[],[]]");\n', {mode:0o755});
  execFileSync(process.execPath,['scripts/desktop-release-train.mjs','--verify'],{
   cwd:new URL('..',import.meta.url).pathname,
   env:{...process.env,PATH:temp+delimiter+process.env.PATH,RELEASE_VERSION:'0.3.2',GITHUB_REPOSITORY:'kzahel/jstorrent'},
   stdio:'pipe',timeout:10000,
  });
 } finally {rmSync(temp,{recursive:true,force:true});}
});
test('released migration prefixes cannot be dropped or rewritten',()=>{
 const old=databaseCompatibility(new URL('..',import.meta.url).pathname);
 const next=structuredClone(old); next.stores.session.target++;next.stores.session.lineage[next.stores.session.target]='a'.repeat(64);
 assertForwardCompatibility(old,next);
 assert.throws(()=>assertForwardCompatibility(next,old),/support/);
 next.stores.product.lineage[2]='b'.repeat(64);
 assert.throws(()=>assertForwardCompatibility(old,next),/changed/);
});

test('migration fingerprints cover later SQL statements without freezing unrelated readers',async()=>{
 const {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');
 const temp=mkdtempSync(join(tmpdir(),'jstorrent-compatibility-source-'));
 const root=new URL('..',import.meta.url).pathname;
 const files=['store_migration.rs','store_schema.rs','product_state.rs','speed.rs','store/file_state.rs','store/safety.rs'];
 try {
  for(const file of files){const name='crates/rstorrent-session/src/'+file;mkdirSync(dirname(join(temp,name)),{recursive:true});copyFileSync(join(root,name),join(temp,name));}
  for(const name of ['catalog/v26.sqlite','product/v2.sqlite']){const file='crates/rstorrent-session/tests/fixtures/'+name;mkdirSync(dirname(join(temp,file)),{recursive:true});copyFileSync(join(root,file),join(temp,file));}
  const old=databaseCompatibility(temp);
  for(const file of files){const path=join(temp,'crates/rstorrent-session/src',file);writeFileSync(path,readFileSync(path,'utf8').replace(/\n/g,'\r\n'));}
  assert.deepEqual(databaseCompatibility(temp),old,'Windows checkouts must produce the same fingerprints');
  for(const file of files){const path=join(temp,'crates/rstorrent-session/src',file);writeFileSync(path,readFileSync(path,'utf8').replace(/\r\n/g,'\n'));}
  const migration=join(temp,'crates/rstorrent-session/src/store_migration.rs');
  writeFileSync(migration,readFileSync(migration,'utf8').replace('ADD COLUMN seed_stop_time_seconds INTEGER CHECK (','ADD COLUMN seed_stop_time_seconds INTEGER CHECK ( /* changed second statement */'));
  const changed=databaseCompatibility(temp);
  assert.equal(changed.stores.session.lineage[26],old.stores.session.lineage[26]);
  assert.notEqual(changed.stores.session.lineage[27],old.stores.session.lineage[27]);
  const bitmap=join(temp,'crates/rstorrent-session/src/store/file_state.rs');
  const before=databaseCompatibility(temp);
  writeFileSync(bitmap,readFileSync(bitmap,'utf8').replace('pub(super) fn read_mask(','// unrelated reader change\npub(super) fn read_mask('));
  assert.deepEqual(databaseCompatibility(temp),before);
 } finally {rmSync(temp,{recursive:true,force:true});}
});
