import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmod,copyFile,mkdir,mkdtemp,readFile,realpath,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=createRequire(join(repo,'clients/web/package.json'))('playwright');

const base=new URL(process.argv[2] ?? 'https://remote.jstorrent.com/');
if(base.protocol!=='https:' || base.origin!=='https://remote.jstorrent.com' || base.pathname!=='/' || base.search || base.hash)throw Error('Expected canonical remote controller root');
await stat(chromium.executablePath());
// This runner registers one disposable authority on the public relay.
// Never remove its profile unless signed route release succeeds.
const root=await realpath(await mkdtemp('/tmp/jstorrent-canonical-remote-'));
await chmod(root,0o700);
const release=join(root,'application/versions/0.1.1');
const bin=join(release,'bin');
const payload=join(root,'payload'),profile=join(root,'profile');
const cfg=join(root,'configuration/headless.toml'),secret=join(root,'secrets/passphrase');
const headless=join(bin,'rstorrent-headless');
const username='ownermove-'+randomBytes(6).toString('hex');
const password=randomBytes(30).toString('base64url');
const result={base:base.href};

for(const p of [bin,join(release,'web'),payload,join(root,'configuration'),join(root,'secrets')]) await mkdir(p,{recursive:true,mode:0o700});
for(const name of ['rstorrent-headless','rstorrent-gateway']) {
  await copyFile(join(repo,'target/debug',name),join(bin,name));
  await chmod(join(bin,name),0o700);
}
await writeFile(join(release,'VERSION'),'0.1.1',{mode:0o600});
await writeFile(join(release,'PACKAGE_ID'),'com.jstorrent.rstorrent.headless',{mode:0o600});
await writeFile(join(release,'web/index.html'),'<!doctype html><title>Canary host</title>',{mode:0o600});
await symlink('versions/0.1.1',join(root,'application/current'));
await writeFile(secret,password,{mode:0o600});
const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
await writeFile(cfg,`version = 4
profile_root = ${JSON.stringify(profile)}
listen = "127.0.0.1:${port}"
public_origin = "http://127.0.0.1:${port}"
[[storage_roots]]
id = "downloads"
label = "Downloads"
path = ${JSON.stringify(payload)}
[authentication]
mode = "local-browser"
[remote_access]
enabled = true
`,{mode:0o600});
let child,context,registered=false,clean=false;
function remote(args){
 const r=spawnSync(headless,['remote','--config',cfg,...args],{encoding:'utf8',timeout:30000});
 if(r.status!==0) throw new Error('Canary administration command failed: '+args[0]);
 return r.stdout;
}
const status=()=>JSON.parse(remote(['status']));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function product(page){await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible',timeout:30000});}
async function passwordPrompt(page){await page.locator('input[type="password"]').waitFor({state:'visible',timeout:25000});}
async function signin(page,shared=false){
 await passwordPrompt(page);
 await page.getByLabel('Route username').fill(username);
 await page.locator('input[type="password"]').fill(password);
 if(shared) await page.getByText('Shared',{exact:true}).click();
 else await page.getByLabel('Browser name shown to the operator').fill('Controller cutover canary');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await product(page);
}
async function launch(path,width=1200){return chromium.launchPersistentContext(path,{headless:true,viewport:{width,height:900},reducedMotion:'reduce'});}
try {
 child=spawn(headless,['--config',cfg],{stdio:['ignore','pipe','pipe']});
 child.stdout.resume();child.stderr.resume();
 for(let i=0;i<100;i++){try{await stat(join(profile,'remote-admin-v1.sock'));break;}catch{if(child.exitCode!==null)throw new Error('Canary host exited before readiness');await delay(100);}}
 registered=true;
 remote(['enable',username,'--passphrase-file',secret]);
 context=await launch(join(root,'browser-private'));
 let page=await context.newPage();const errors=[],destinations=new Set();
 page.on('pageerror',e=>errors.push(e.name));
 page.on('request',r=>destinations.add(new URL(r.url()).origin));
 page.on('websocket',s=>destinations.add(new URL(s.url()).origin));
 const response=await page.goto(result.base,{waitUntil:'networkidle'});
 assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');
 await passwordPrompt(page);
 await page.setViewportSize({width:390,height:844});
 await signin(page);result.privateSignIn=true;
 assert.equal(status().authority.clients.length,1);
 // The ordinary empty product view contains no credential or route identifier.
 assert.equal((await page.locator('body').innerText()).includes(username),false);
 await page.reload();await product(page);
 assert.equal(await page.locator('input[type="password"]').isVisible(),false);result.reloadResume=true;
 await context.close();context=undefined;
 context=await launch(join(root,'browser-private'),1200);page=await context.newPage();
 await page.goto(result.base);await product(page);result.browserRestartResume=true;
 const client=status().authority.clients[0];assert.ok(client.client_id);
 remote(['revoke',client.client_id]);
 await page.reload();await passwordPrompt(page);
 assert.equal(status().authority.clients.length,0);result.revocationReturnsToSignIn=true;
 await context.close();context=undefined;
 context=await launch(join(root,'browser-shared'),390);page=await context.newPage();
 await page.goto(result.base);await signin(page,true);
 assert.equal(status().authority.clients.length,0);result.sharedSignIn=true;
 await context.close();context=undefined;
 context=await launch(join(root,'browser-shared'),390);page=await context.newPage();
 await page.goto(result.base);await passwordPrompt(page);result.sharedRestartRequiresPassword=true;
 assert.equal(errors.length,0);
 assert.deepEqual([...destinations].sort(),[base.origin,'wss://relay.rstorrent.com'].sort());
 result.noThirdPartyRequests=true;result.pageErrors=0;
} finally {
 if(context) await context.close();
 let cleanupError;
 if(registered){try{remote(['disable']);registered=false;result.signedRouteReleased=true;}catch(error){cleanupError=error;}}

 if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);if(child.exitCode===null)child.kill('SIGKILL');}
 clean=!registered;
 if(clean) await rm(root,{recursive:true,force:true});
 else throw new Error('Signed release failed; authority retained for recovery at '+root, {cause:cleanupError});
}
console.log(JSON.stringify(result));
