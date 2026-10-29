import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseMetadata } from './desktop-release-metadata.mjs';
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
export function isPublishedDesktopRelease(release) {
  return !release.draft && /^desktop-(?:latest-)?v\d+\.\d+\.\d+$/.test(release.tag_name) &&
    release.assets?.some(asset => asset.name === 'JSTorrent_x64.app.tar.gz');
}
export function nextDesktopVersion(base, releases) {
  let maximum = base;
  numericVersion(base);
  for (const release of releases) {
    // A recognizable JSTorrent draft already occupies its version. Keep
    // public channel selection separate, and never reuse its signed assets
    // for a different source after an interrupted publication.
    if (!/^desktop-(?:latest-)?v\d+\.\d+\.\d+$/.test(release.tag_name) ||
        !release.assets?.some(asset => asset.name === 'JSTorrent_x64.app.tar.gz')) continue;
    const match = /^desktop-(?:latest-)?v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if (match && compare(match[1], maximum) > 0) maximum = match[1];
  }
  const parts = numericVersion(maximum);
  if (++parts[2] > 65535) { parts[2]=0; if(++parts[1]>255){parts[1]=0;parts[0]++;} }
  const version=parts.join('.'); numericVersion(version); return version;
}
export function assertNewDesktopVersion(version, releases) {
  for (const release of releases) {
    if (!isPublishedDesktopRelease(release)) continue;
    const match = /^desktop-(?:latest-)?v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if(match && compare(version, match[1])<=0) throw new Error('New desktop builds must advance both release channels');
  }
}
function releases(repo) {
  return JSON.parse(execFileSync('gh',['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`],{encoding:'utf8',maxBuffer:32*1024*1024})).flat();
}
let isMain = false;
try { isMain = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch {}
if (isMain) {
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
      const latest=await readReleaseMetadata(response);
      if(compare(latest.version,'0.3.2')>=0 && !latest.compatibility)throw new Error('Published release is missing required database facts');
      if(latest.compatibility)assertForwardCompatibility(JSON.parse(Buffer.from(latest.compatibility.data,'base64').toString()).databases,current);
    }
  } else {
    const base=JSON.parse(readFileSync(resolve(root,'clients/desktop/src-tauri/tauri.conf.json'))).version;
    const next=nextDesktopVersion(base,list);
    appendFileSync(process.env.GITHUB_OUTPUT,`version=${next}\ntag=desktop-latest-v${next}\n`);
  }
}
