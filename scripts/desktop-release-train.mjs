import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertForwardCompatibility, databaseCompatibility } from './desktop-compatibility.mjs';
export function numericVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Numeric desktop version required');
  const parts = version.split('.').map(Number);
  if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65535) throw new Error('Desktop version exceeds native bounds');
  return parts;
}
export function compare(a,b) {
  const left = numericVersion(a), right = numericVersion(b);
  for (let i=0;i<3;i++) if(left[i]!==right[i])return left[i]-right[i];
  return 0;
}
export function nextDesktopVersion(base, releases) {
  let maximum = base;
  numericVersion(base);
  for (const release of releases) {
    if (release.draft || !release.assets?.some(asset => asset.name === 'JSTorrent_x64.app.tar.gz')) continue;
    const match = /^desktop-(?:latest-)?v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if (match && compare(match[1], maximum) > 0) maximum = match[1];
  }
  const parts = numericVersion(maximum);
  if (++parts[2] > 65535) { parts[2]=0; if(++parts[1]>255){parts[1]=0;parts[0]++;} }
  const version=parts.join('.'); numericVersion(version); return version;
}
export function assertNewDesktopVersion(version, releases) {
  for (const release of releases) {
    if (release.draft || !release.assets?.some(asset => asset.name === 'JSTorrent_x64.app.tar.gz')) continue;
    const match = /^desktop-(?:latest-)?v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if(match && compare(version, match[1])<=0) throw new Error('New desktop builds must advance both release channels');
  }
}
function releases(repo) {
  return JSON.parse(execFileSync('gh',['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`,'--jq','.'],{encoding:'utf8',maxBuffer:32*1024*1024})).flat();
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const root=resolve(import.meta.dirname,'..');
  const repo=process.env.GITHUB_REPOSITORY || 'kzahel/jstorrent';
  const list=releases(repo);
  const version=process.env.RELEASE_VERSION;
  if (process.argv.includes('--verify')) {
    assertNewDesktopVersion(version,list);
    const current=databaseCompatibility(root);
    for(const release of list) {
      if(release.draft || !release.assets?.some(a=>a.name==='JSTorrent_x64.app.tar.gz'))continue;
      const asset=release.assets.find(a=>a.name==='latest.json'); if(!asset)continue;
      const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Cannot audit previous release compatibility');
      const text=await response.text(); if(text.length>65536)throw new Error('Oversized previous manifest');
      const latest=JSON.parse(text);
      if(latest.compatibility)assertForwardCompatibility(JSON.parse(Buffer.from(latest.compatibility.data,'base64').toString()).databases,current);
    }
  } else {
    const base=JSON.parse(readFileSync(resolve(root,'clients/desktop/src-tauri/tauri.conf.json'))).version;
    const next=nextDesktopVersion(base,list);
    appendFileSync(process.env.GITHUB_OUTPUT,`version=${next}\ntag=desktop-latest-v${next}\n`);
  }
}
