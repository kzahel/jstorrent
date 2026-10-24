#!/usr/bin/env node
// Product display names and original asset provenance, separately from wire identities.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from '../clients/web/node_modules/jsdom/lib/api.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const failures=[];
let checked=0;
function display(location,value) {
  checked++;
  if(/rstorrent/i.test(value)) failures.push(`${location}: obsolete display brand`);
}
for(const [key,entry] of Object.entries(JSON.parse(read('clients/web/src/localization/messages/en.json')))) display(`web:${key}`,entry.defaultMessage);
for(const [key,value] of Object.entries(JSON.parse(read('clients/desktop/src-tauri/locales/en.json')))) display(`desktop:${key}`,value);
for(const file of ['Localizable','InfoPlist']) for(const [key,entry] of Object.entries(JSON.parse(read(`clients/ios/App/Localization/${file}.xcstrings`)).strings)) {
  for(const [locale,value] of Object.entries(entry.localizations ?? {})) display(`ios:${file}:${key}:${locale}`,JSON.stringify(value));
}
const strings=read('clients/android/app/src/main/res/values/strings.xml');
const android=new JSDOM(strings,{contentType:'text/xml'}).window.document;
for(const node of android.querySelectorAll('string,plurals')) display(`android:${node.getAttribute('name')}`,node.textContent);
for(const file of ['clients/extension/popup/popup.html','clients/extension/crostini/setup.html','clients/extension/crostini/connect.html','clients/web/index.html','clients/web/companion.html','clients/web/remote.html','website/src/pages/index.astro','website/src/pages/404.astro']) {
  // Astro frontmatter is source, not page text. All HTML attributes with display semantics count.
  const html=read(file).replace(/^---[\s\S]*?---/,'');
  const dom=new JSDOM(html).window.document;
  for(const node of dom.querySelectorAll('script,style')) node.remove();
  display(file,dom.documentElement.textContent);
  for(const node of dom.querySelectorAll('[alt],[title],[aria-label]')) for(const attr of ['alt','title','aria-label']) display(`${file}:${attr}`,node.getAttribute(attr)??'');
}
for(const file of ['clients/desktop/src-tauri/tauri.conf.json','clients/desktop/src-tauri/tauri.dev.conf.json','clients/desktop/src-tauri/tauri.jstorrent.conf.json','clients/extension/manifest.json']) {
  const config=JSON.parse(read(file));
  display(file,config.productName??config.name);
  if(config.bundle) for(const key of ['shortDescription','longDescription']) display(`${file}:${key}`,config.bundle[key]??'');
}
for(const file of ['clients/android/play/listing/en-US/title.txt','clients/android/play/listing/en-US/short-description.txt','clients/android/play/listing/en-US/full-description.txt']) display(file,read(file));
const provenance=JSON.parse(read('distribution/branding/jstorrent-assets.json'));
for(const asset of provenance.assets) {
  const bytes=fs.readFileSync(path.join(root,asset.path));
  if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256) failures.push(`${asset.path}: original asset checksum changed`);
}
if(failures.length) { console.error(failures.join('\n'));process.exitCode=1; }
else console.log(`Branding valid: ${checked} display values and ${provenance.assets.length} original JSTorrent assets. Internal paths, URLs, keys, wire identities and third-party text are preserved.`);
