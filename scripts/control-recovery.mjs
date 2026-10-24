#!/usr/bin/env node
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {drillRecoveryBundle,restoreRecoveryBundle,readPrivateFile,maxBundleBytes} from '../apps/api/dist/recovery.js';

export async function main(args=process.argv.slice(2)){
 const [action,bundlePath,flag,passphrasePath,destination,...extra]=args;
 if(!['verify','restore'].includes(action)||!bundlePath||flag!=='--passphrase-file'||!passphrasePath||extra.length||(action==='restore'?!destination:destination!==undefined))throw Error('usage');
 const passBytes=await readPrivateFile(passphrasePath,513);let passphrase;
 try{passphrase=passBytes.toString('utf8').replace(/\r?\n$/,'');}finally{passBytes.fill(0);}
 const bundle=await readPrivateFile(bundlePath,maxBundleBytes);
 if(action==='restore')return restoreRecoveryBundle(bundle,passphrase,resolve(destination));
 const work=await mkdtemp(join(tmpdir(),'devone-recovery-'));
 try{return await drillRecoveryBundle(bundle,passphrase,work);}
 finally{await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(result=>console.log(JSON.stringify({status:'passed',...result}))).catch(()=>{
  console.error('Recovery failed. Check bundle/passphrase, private file permissions, and a NEW destination under a private parent directory. No live activation was performed.');
  console.error('Usage: node scripts/control-recovery.mjs verify BUNDLE --passphrase-file PRIVATE_FILE');
  console.error('   or: node scripts/control-recovery.mjs restore BUNDLE --passphrase-file PRIVATE_FILE NEW_DIRECTORY');
  process.exitCode=1;
 });
}
