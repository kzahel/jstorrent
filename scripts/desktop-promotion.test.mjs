import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPromotionFresh, planDesktopPromotion,promotedManifest } from './desktop-promotion.mjs';
const repo='kzahel/jstorrent',version='0.3.8',tag='desktop-latest-v'+version;
const names=['latest.json','SHA256SUMS','JSTorrent_x64.app.tar.gz','JSTorrent_aarch64.app.tar.gz',`JSTorrent_${version}_AppImage-sources-final.tar.gz`,...Array.from({length:12},(_,i)=>'asset'+i)];
const release={tag_name:tag,draft:false,prerelease:true,assets:names.map(name=>({name,size:1,digest:'sha256:'+'a'.repeat(64),browser_download_url:`https://github.com/${repo}/releases/download/${tag}/${name}`}))};
test('promotion preserves version and native inventory while rebinding metadata URLs',()=>{
 const plan=planDesktopPromotion(release,'0.3.1',repo);
 assert.equal(plan.tag,'desktop-v0.3.8');assert.deepEqual(plan.assets,release.assets);
 const latest={version,compatibility:{data:'signed-original-facts',signature:'signature'},platforms:{'darwin-x86_64':{url:release.assets[2].browser_download_url,signature:'unchanged-payload-signature'}}};
 const promoted=promotedManifest(latest,plan,repo);
 assert.equal(promoted.version,version);assert.equal(promoted.platforms['darwin-x86_64'].signature,latest.platforms['darwin-x86_64'].signature);
 assert.equal(promoted.platforms['darwin-x86_64'].url,`https://github.com/${repo}/releases/download/desktop-v${version}/JSTorrent_x64.app.tar.gz`);
 assert.deepEqual(promoted.compatibility,latest.compatibility);assert.deepEqual(latest.platforms['darwin-x86_64'].url,release.assets[2].browser_download_url);
});
test('rejects wrong channel, backward/same Stable, missing bytes and foreign artifacts',()=>{
 for(const bad of [{...release,draft:true},{...release,prerelease:false},{...release,tag_name:'desktop-v0.3.8'},{...release,assets:release.assets.slice(1)},{...release,assets:release.assets.map((a,i)=>i===0?{...a,digest:'bad'}:a)}]) assert.throws(()=>planDesktopPromotion(bad,'0.3.1',repo));
 assert.throws(()=>planDesktopPromotion(release,version,repo));assert.throws(()=>planDesktopPromotion(release,'0.3.9',repo));
 assert.throws(()=>planDesktopPromotion(release,'0.3.1','other/repo'));
});

test('promotion preserves tested database facts even when main has advanced',async()=>{
 const {compatibilityForSigning}=await import('./desktop-promotion.mjs');
 const latest={version:'0.3.8',platforms:{target:{signature:'signed-native-payload'}}};
 const previous={schemaVersion:1,version:latest.version,identifier:'com.jstorrent.desktop',platforms:latest.platforms,databases:{tested:true}};
 assert.deepEqual(compatibilityForSigning(latest,{newer:true},previous),{tested:true});
 assert.deepEqual(compatibilityForSigning(latest,{newer:true}),{newer:true});
 assert.throws(()=>compatibilityForSigning({...latest,version:'0.3.9'},{},previous));
 assert.throws(()=>compatibilityForSigning({...latest,platforms:{target:{signature:'different'}}},{},previous));
});

test('source carriers retain their established two GiB bound independently of payloads',()=>{
 const withSize=(index,size)=>({...release,assets:release.assets.map((a,i)=>i===index?{...a,size}:a)});
 assert.doesNotThrow(()=>planDesktopPromotion(withSize(4,925938523),'0.3.1',repo));
 assert.throws(()=>planDesktopPromotion(withSize(4,2*1024**3+1),'0.3.1',repo));
 assert.throws(()=>planDesktopPromotion(withSize(2,512*1024**2+1),'0.3.1',repo));
});

test('a prepared promotion refuses an intervening Stable or mutated Latest',()=>{
 const stable={...release,id:17,tag_name:'desktop-v0.3.1',prerelease:false};
 const sourceSha='a'.repeat(40);
 const plan={...planDesktopPromotion(release,'0.3.1',repo),sourceSha,previousStableVersion:'0.3.1',previousStableId:17,
  previousStableManifestDigest:stable.assets[0].digest,
  sourceAssets:release.assets.map(({name,size,digest})=>({name,size,digest})).sort((a,b)=>a.name.localeCompare(b.name))};
 assert.doesNotThrow(()=>assertPromotionFresh(plan,[stable],release,sourceSha));
 const intervening={...stable,id:18,tag_name:'desktop-v0.3.9'};
 assert.throws(()=>assertPromotionFresh(plan,[stable,intervening],release,sourceSha),/Stable changed/);
 assert.throws(()=>assertPromotionFresh(plan,[{...stable,id:19}],release,sourceSha),/replaced/);
 const changed={...release,assets:release.assets.map((asset,i)=>i===2?{...asset,digest:'sha256:'+'b'.repeat(64)}:asset)};
 assert.throws(()=>assertPromotionFresh(plan,[stable],changed,sourceSha),/assets changed/);
 assert.throws(()=>assertPromotionFresh(plan,[stable],release,'b'.repeat(40)),/tag changed/);
 const changedStable={...stable,assets:stable.assets.map((asset,i)=>i===0?{...asset,digest:'sha256:'+'c'.repeat(64)}:asset)};
 assert.throws(()=>assertPromotionFresh(plan,[changedStable],release,sourceSha),/metadata changed/);
});
