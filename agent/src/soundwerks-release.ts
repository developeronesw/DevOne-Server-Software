import {validAdminPassword,validAdminUsername} from './install-account.js';

// Reviewed, immutable Git commit. No user-supplied repository, branch, scripts,
// URLs or package commands can reach the privileged Agent.
export const soundwerksRelease={
  version:'0.1.0-preview',
  source:'https://github.com/developeronesw/CreativeSoundwerks2.git',
  commit:'b4110f83a186dff110faf0f69312397904ad1930',
  preview:true
} as const;

export type SoundwerksInstall={
 id:string;databaseId:string;databasePassword:string;
 adminUsername:string;adminPassword:string;email:string;title:string;
 siteId?:string;domain?:string;expectedRevision?:number;
};
export function soundwerksInput(value:unknown):SoundwerksInstall{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_soundwerks_request');
 const b=value as SoundwerksInstall;
 if(Object.keys(b).some(k=>!['id','databaseId','databasePassword','adminUsername','adminPassword','email','title','siteId','domain','expectedRevision'].includes(k))||
  !/^app_[a-f0-9]{16}$/.test(b.id)||!/^db_[a-f0-9]{16}$/.test(b.databaseId)||
  !/^[a-f0-9]{64}$/.test(b.databasePassword)||!validAdminPassword(b.adminPassword)||
  !validAdminUsername(b.adminUsername)||typeof b.title!=='string'||b.title.trim()!==b.title||
  b.title.length<2||b.title.length>90||/[\x00-\x1f\x7f<>]/.test(b.title)||
  typeof b.email!=='string'||b.email.length>254||
  !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(b.email))
  throw Error('invalid_soundwerks_request');
 if(b.siteId!==undefined?
  (typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||
   !Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):
  (b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||
   !b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||
   !/\.[a-z]{2,63}$/.test(b.domain)))
  throw Error('invalid_soundwerks_target');
 return b;
}
