import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { currentDesktopStable, planDesktopPromotion, promotedManifest } from './desktop-promotion.mjs';
import { assertForwardCompatibility } from './desktop-compatibility.mjs';
import { readReleaseMetadata } from './desktop-release-metadata.mjs';
import { compare } from './desktop-release-train.mjs';
import { verifySignature, updaterPublicKey } from './verify-desktop-signatures.mjs';
const root=resolve(import.meta.dirname,'..');
const [sourceTag,output]=process.argv.slice(2);
assert(/^desktop-latest-v\d+\.\d+\.\d+$/.test(sourceTag??''),'exact Latest source tag required');
assert(output,'usage: prepare-desktop-promotion.mjs LATEST_TAG OUTPUT');
const repo='kzahel/jstorrent';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const api=path=>JSON.parse(gh(['api',`repos/${repo}/${path}`]));
const releases=JSON.parse(gh(['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`])).flat();
const stable=currentDesktopStable(releases);
const previousStableVersion=stable.tag_name.slice(9);
const source=api(`releases/tags/${sourceTag}`);
const plan=planDesktopPromotion(source,previousStableVersion,repo);
const sourceSha=api(`commits/${sourceTag}`).sha;
assert(/^[a-f0-9]{40}$/.test(sourceSha),'exact source commit required');
const directory=resolve(output);mkdirSync(directory,{recursive:false});
const assets=join(directory,'assets');mkdirSync(assets);
gh(['release','download',sourceTag,'--repo',repo,'--dir',assets]);
async function digest(file,maximum){let size=0;const hash=createHash('sha256');for await(const chunk of createReadStream(file)){size+=chunk.length;assert(size<=maximum,'oversized promotion asset');hash.update(chunk);}return {size,digest:'sha256:'+hash.digest('hex')};}
for(const asset of plan.assets){const observed=await digest(join(assets,asset.name),asset.size);assert.equal(observed.size,asset.size,'truncated promotion asset');assert.equal(observed.digest,asset.digest,'changed promotion asset');}
const latestPath=join(assets,'latest.json');assert(statSync(latestPath).size<=65536,'oversized updater metadata');
const latest=JSON.parse(readFileSync(latestPath,'utf8'));
assert.equal(latest.version,plan.version);
assert(latest.compatibility,'authenticated database facts required');
const original=Buffer.from(latest.compatibility.data,'base64');assert(original.length<=48*1024);
const originalPath=join(directory,'original-compatibility.json');writeFileSync(originalPath,original);
verifySignature(originalPath,latest.compatibility.signature,updaterPublicKey('JSTorrent'));
const facts=JSON.parse(original.toString());
assert.equal(facts.identifier,'com.jstorrent.desktop');assert.equal(facts.version,latest.version);assert.deepEqual(facts.platforms,latest.platforms,'signed payload inventory differs');
const stableManifestAsset=stable.assets.find(asset=>asset.name==='latest.json');assert(stableManifestAsset);
assert(/^sha256:[a-f0-9]{64}$/.test(stableManifestAsset.digest),'existing Stable metadata digest required');
const stableResponse=await fetch(stableManifestAsset.browser_download_url,{signal:AbortSignal.timeout(15000)});assert(stableResponse.ok,'cannot verify existing Stable facts');
const stableManifest=await readReleaseMetadata(stableResponse);
if(compare(previousStableVersion,'0.3.2')>=0)assert(stableManifest.compatibility,'existing Stable is missing database facts');
if(stableManifest.compatibility){
 const stableFacts=Buffer.from(stableManifest.compatibility.data,'base64');assert(stableFacts.length<=48*1024);
 const stableFactsPath=join(directory,'previous-stable-compatibility.json');writeFileSync(stableFactsPath,stableFacts);
 verifySignature(stableFactsPath,stableManifest.compatibility.signature,updaterPublicKey('JSTorrent'));
 assertForwardCompatibility(JSON.parse(stableFacts.toString()).databases,facts.databases);
}

const signatures=plan.assets.filter(a=>a.name.endsWith('.sig'));assert.equal(signatures.length,6);
for(const asset of signatures)verifySignature(join(assets,asset.name.slice(0,-4)),readFileSync(join(assets,asset.name),'utf8').trim(),updaterPublicKey('JSTorrent'));
writeFileSync(latestPath,JSON.stringify(promotedManifest(latest,plan,repo),null,2)+'\n');
const release={tagName:plan.tag,isDraft:true,isPrerelease:false,assets:plan.assets.map(a=>({name:a.name,size:a.size,digest:a.digest}))};
writeFileSync(join(directory,'release.json'),JSON.stringify(release,null,2)+'\n');
execFileSync(process.execPath,[join(root,'scripts/sign-desktop-compatibility.mjs'),directory,'--promote'],{stdio:'inherit'});
const inventory=[];
for(const asset of release.assets){if(asset.name==='SHA256SUMS')continue;const maximum=asset.name.endsWith('_AppImage-sources-final.tar.gz')?2*1024*1024*1024:512*1024*1024;Object.assign(asset,await digest(join(assets,asset.name),maximum));if(!asset.name.endsWith('.sig'))inventory.push(`${asset.digest.slice(7)}  ${asset.name}`);}
writeFileSync(join(assets,'SHA256SUMS'),inventory.sort().join('\n')+'\n');
Object.assign(release.assets.find(a=>a.name==='SHA256SUMS'),await digest(join(assets,'SHA256SUMS'),65536));
writeFileSync(join(directory,'release.json'),JSON.stringify(release,null,2)+'\n');
const sourceAssets=source.assets.map(({name,size,digest})=>({name,size,digest})).sort((a,b)=>a.name.localeCompare(b.name));
writeFileSync(join(directory,'promotion.json'),JSON.stringify({sourceTag,sourceSha,tag:plan.tag,version:plan.version,previousStableVersion,previousStableId:stable.id,previousStableManifestDigest:stableManifestAsset.digest,sourceAssets},null,2)+'\n');
assert(typeof source.body === 'string' && source.body.trim(), 'Latest release notes required');
writeFileSync(join(directory,'notes.md'),`${source.body.trim()}\n\nPromoted the tested JSTorrent Latest ${plan.version} packages without rebuilding.\n\nSource: ${sourceSha}\nLatest: https://github.com/${repo}/releases/tag/${sourceTag}\n\nNative packages, detached payload signatures and corresponding sources retain their original bytes. Updater metadata and checksums are regenerated for Stable.\n`);
console.log(`Prepared ${plan.tag} from exact ${sourceTag} bytes; nothing published`);
