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
test('released migration prefixes cannot be dropped or rewritten',()=>{
 const old=databaseCompatibility(new URL('..',import.meta.url).pathname);
 const next=structuredClone(old); next.stores.session.target++;next.stores.session.lineage[next.stores.session.target]='a'.repeat(64);
 assertForwardCompatibility(old,next);
 assert.throws(()=>assertForwardCompatibility(next,old),/support/);
 next.stores.product.lineage[2]='b'.repeat(64);
 assert.throws(()=>assertForwardCompatibility(old,next),/changed/);
});
