// Run against owned loopback servers; always uses Playwright's bundled Chromium.
import { chromium } from '../../clients/web/node_modules/@playwright/test/index.mjs';
import AxeBuilder from '../../clients/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const phase = process.argv[2] ?? 'after';
const output = path.resolve(process.argv[3] ?? `docs/evidence/258-brand-audit/${phase}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence = [];
async function capture(name, url, { width = 1440, theme = 'light', platform, prepare, blockBootstrap, originalShell } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if(blockBootstrap) await page.route('**/src/main.ts*',route=>route.abort());
  if(originalShell) await page.route('http://127.0.0.1:4190/',route=>route.fulfill({contentType:'text/html',body:execFileSync('git',['show','HEAD:clients/web/index.html'],{encoding:'utf8'})}));
  await page.addInitScript(({theme, platform}) => {
    localStorage.setItem('rstorrent.presentation.appearance', JSON.stringify({version: 1, colorTheme: theme, interfaceSize: 'standard', dataUnits: 'bytes'}));
    if (platform) window.chrome = {
      runtime: { getPlatformInfo: async () => ({os: platform}), getURL: p => 'http://127.0.0.1:4191/' + p,
        sendMessage: async m => m.type === 'productMetrics' ? {ok:true, state:{disclosureVersion:1,statisticsEnabled:false,createdAtMillis:String(Date.now()),sessions:1,everConnected:false}} : {ok:false,error:{message:'Install JSTorrent Desktop and open it once to finish setup.'}} },
      extension: {getViews: () => []}, tabs: {create: async () => ({})}, permissions: {contains: async () => false, request: async () => false},
    };
  }, {theme, platform});
  try {
    await page.goto(url);
    if (prepare) await prepare(page);
    await page.evaluate(() => document.fonts.ready);
    const text = await page.locator('body').innerText();
    const fields = await page.locator('textarea:visible,input:visible').evaluateAll(es => es.map(e=>e.value).join('\n'));
    const violations = (await new AxeBuilder({page}).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({path:path.join(output, `${name}.png`),fullPage:true});
    evidence.push({name,width,theme,title:await page.title(),obsoleteDisplayBrand:/rstorrent/i.test(text+'\n'+fields+'\n'+await page.title()),overflow,violations,errors,method:platform?'rendered with mocked Chrome platform APIs':'rendered application/page',text});
  } catch (error) { evidence.push({name, failure:String(error),errors}); }
  await context.close();
}
try {
  if (phase === 'extras-after') {
    await capture('headless-update','http://127.0.0.1:4190/tests/fixtures/support-harness.html?manual=1',{width:390,prepare:async p=>{
      await p.context().grantPermissions(['clipboard-read','clipboard-write']);
      await p.getByRole('button',{name:'Copy update command'}).click();
      if(await p.evaluate(()=>navigator.clipboard.readText()) !== '$HOME/.local/bin/rstorrent-headless update --apply') throw Error('Update command changed');
    }});
    await capture('linux-setup-dark','http://127.0.0.1:4191/crostini/setup.html',{width:900,theme:'dark',prepare:async p=>{
      await p.context().grantPermissions(['clipboard-read','clipboard-write']);
      for(const b of await p.locator('button[data-command]').all()) {
        const expected=await b.getAttribute('data-command');await b.click();
        if(await p.evaluate(()=>navigator.clipboard.readText()) !== expected) throw Error('Linux command changed');
      }
    }});
    await capture('remote-scroll','http://127.0.0.1:4190/tests/fixtures/branding-harness.html?surface=remote&theme=light',{width:390,prepare:async p=>{
      await p.getByRole('button',{name:'Sign in',exact:true}).scrollIntoViewIfNeeded();
      const clipped=await p.getByRole('button',{name:'Sign in',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.bottom>innerHeight||r.top<0});
      if(clipped)throw Error('Sign-in control clipped');
    }});
  } else if (phase === 'shell-before') {
    await capture('bootstrap-error','http://127.0.0.1:4190/',{width:390,blockBootstrap:true,originalShell:true,prepare:async p=>{await p.locator('#rstorrent-boot-status[role=alert]').waitFor();}});
  } else if (phase.startsWith('gateway-')) {
    await capture('linux-handoff','http://jstorrent.localhost:3030/launch-chromeos',{width:390});
  } else {
  for (const width of [1440,390]) {
    await capture(`website-${width}`, 'http://127.0.0.1:4192/', {width});
  }
  await capture('website-404', 'http://127.0.0.1:4192/404.html');
  for (const platform of ['cros','mac','unknown']) for (const theme of phase === 'before'?['light']:['light','dark']) {
    await capture(`extension-${platform}-${theme}`, 'http://127.0.0.1:4191/popup/popup.html', {width:390,theme,platform,
      prepare:async p=>{await p.getByRole('button',{name:/Connect Android app|Open torrent library/}).first().waitFor();const details=p.locator('details').filter({hasText:'Linux'});if(await details.count())await details.first().evaluate(e=>e.open=true);}});
  }
  await capture('linux-setup','http://127.0.0.1:4191/crostini/setup.html',{width:900});
  await capture('linux-connection','http://127.0.0.1:4191/crostini/connect.html',{width:390,platform:'cros'});
  for(const theme of phase==='before'?['light']:['light','dark']) {
    await capture(`support-${theme}`,'http://127.0.0.1:4190/tests/fixtures/support-harness.html?theme='+theme,{width:900,theme,prepare:async p=>{await p.getByRole('button',{name:'Prepare diagnostics'}).click();}});
  }
  await capture('bootstrap-error','http://127.0.0.1:4190/',{width:390,blockBootstrap:true,originalShell:phase==='before',prepare:async p=>{await p.locator('#rstorrent-boot-status[role=alert]').waitFor();}});
  if(phase==='after') {
    for(const width of [1440,390]) for(const theme of ['light','dark']) {
      const options={width,theme};
      const url='http://127.0.0.1:4190/?demo=healthy-download&at=42000&autoplay=0';
      await capture(`torrents-${width}-${theme}`,url,{...options,prepare:async p=>{await p.getByRole('grid',{name:'Torrents'}).waitFor();}});
      await capture(`library-${width}-${theme}`,url,{...options,prepare:async p=>{await p.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:'Library'}).click();}});
      await capture(`add-${width}-${theme}`,`http://127.0.0.1:4190/tests/fixtures/branding-harness.html?surface=add&theme=${theme}`,{...options,prepare:async p=>{await p.getByRole('dialog').waitFor();}});
      await capture(`settings-${width}-${theme}`,url,{...options,prepare:async p=>{await p.getByRole('button',{name:'Settings',exact:true}).click();}});
    }
    for(const category of ['Downloads','Connection & seeding']) {
      await capture(`settings-${category.toLowerCase().replace(/[^a-z]+/g,'-')}`,'http://127.0.0.1:4190/?demo=healthy-download&at=42000&autoplay=0',{width:1440,prepare:async p=>{await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('dialog',{name:'Settings'}).getByRole('tab',{name:category}).click();}});
    }
    for(const tab of ['General','Files','Peers','Trackers','Pieces','Swarm']) {
      await capture(`detail-${tab.toLowerCase()}`,'http://127.0.0.1:4190/?demo=healthy-download&at=42000&autoplay=0',{prepare:async p=>{await p.getByRole('row').filter({hasText:'Big Buck Bunny 1080p surround'}).click();await p.getByRole('tab',{name:tab,exact:true}).click();}});
    }
    for(const tab of ['Disk','DHT','Speed','Logs']) await capture(`session-${tab.toLowerCase()}`,'http://127.0.0.1:4190/?demo=healthy-download&at=42000&autoplay=0',{prepare:async p=>{await p.getByRole('tab',{name:tab,exact:true}).click();}});
    for(const theme of ['light','dark']) {
      for(const surface of ['remote','web-auth']) await capture(`auth-${surface}-${theme}`,
        `http://127.0.0.1:4190/tests/fixtures/branding-harness.html?surface=${surface}&theme=${theme}`,
        {width:390,theme,prepare:async p=>{await p.getByRole('heading').first().waitFor();}});
      await capture(`auth-expired-${theme}`,`http://127.0.0.1:4190/tests/fixtures/branding-harness.html?state=initial_window_expired&theme=${theme}`,
        {width:390,theme});
    }

    await capture('android-unavailable','http://127.0.0.1:4190/companion.html',{width:390,platform:'cros',prepare:async p=>{await p.getByRole('button',{name:/Retry connection|Retry/}).waitFor();}});
  }
  }
} finally {
  await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify(evidence.map(({text,...rest})=>rest),null,2));
if(evidence.some(e=>e.failure || ((phase==='after'||phase.endsWith('-after')) && (e.obsoleteDisplayBrand||e.overflow||e.errors.length||e.violations.length)))) process.exitCode=1;
