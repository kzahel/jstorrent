import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { verifySignature,updaterPublicKey } from './verify-desktop-signatures.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]);
const latest=JSON.parse(readFileSync(join(directory,'assets/latest.json'),'utf8'));
const original=Buffer.from(latest.compatibility.data,'base64');
const work=mkdtempSync(join(tmpdir(),'jstorrent-cohort-signing-'));
try{
 const file=join(work,'compatibility.json');writeFileSync(file,original);
 verifySignature(file,latest.compatibility.signature,updaterPublicKey('JSTorrent'));
 const facts=JSON.parse(original.toString());
 const platforms={};
 for(const target of ['darwin-aarch64','darwin-x86_64','windows-x86_64','linux-aarch64','linux-x86_64']){
  const payload=latest.platforms[target];if(!payload)throw new Error('Missing cohort target');
  const name=decodeURIComponent(new URL(payload.url).pathname.split('/').at(-1));
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name))throw new Error('Invalid cohort filename');
  const path=join(directory,'assets',name);let size=0;const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)){size+=chunk.length;if(size>512*1024*1024)throw new Error('Oversized cohort payload');hash.update(chunk);}
  const sha256=hash.digest('hex');
  platforms[target]={url:`https://updates.jstorrent.com/qualification/${sha256}/${encodeURIComponent(name)}`,signature:payload.signature,size,sha256};
 }
 facts.platforms=Object.fromEntries(Object.entries(platforms).map(([key,{url,signature}])=>[key,{url,signature}]));
 const bytes=Buffer.from(JSON.stringify(facts));writeFileSync(file,bytes);
 execFileSync(join(root,'clients/web/node_modules/.bin/tauri'),['signer','sign',file],{stdio:'pipe'});
 const signature=readFileSync(file+'.sig','utf8').trim();verifySignature(file,signature,updaterPublicKey('JSTorrent'));
 const candidate={version:latest.version,notes:'Private owned-VM update qualification; not a public release.',pub_date:latest.pub_date,
  automaticInstall:true,sourceSha:process.env.SOURCE_SHA,runId:process.env.GITHUB_RUN_ID,attempt:Number(process.env.GITHUB_RUN_ATTEMPT),platforms,
  compatibility:{data:bytes.toString('base64'),signature}};
 writeFileSync(join(directory,'cohort-candidate.json'),JSON.stringify(candidate,null,2)+'\n');
 const receipt=join(root,'distribution/private-update-qualification.json');
 if(existsSync(receipt))writeFileSync(join(directory,'private-qualification-source.json'),readFileSync(receipt));
}finally{rmSync(work,{recursive:true,force:true});}
