// Prebuilt from the reviewed, tested CMS source commit; no npm/build on the VPS.
export const cmsRelease={version:'2.0.0-alpha.4',sourceRepository:'developeronesw/DevOneCMS-v2',sourceCommit:'76170ee10e59f1f8fc772951b6796a57a122ed14',sha256:'cd546994daccae82e3e4d4bcda10328291f51c26bf3573ead47d059968d07528',file:'2.0.0-alpha.4.tar.gz',bytes:109166,preview:true} as const;
export type CmsInstall={id:string;adminPassword:string;title:string;email:string;siteId?:string;domain?:string;expectedRevision?:number};
export function cmsInput(value:unknown):CmsInstall{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_cms_request');
 const b=value as CmsInstall;
 if(Object.keys(b).some(k=>!['id','adminPassword','title','email','siteId','domain','expectedRevision'].includes(k))||!/^app_[a-f0-9]{16}$/.test(b.id)||! /^[a-f0-9]{64}$/.test(b.adminPassword)||typeof b.title!=='string'||b.title.trim()!==b.title||b.title.length<2||b.title.length>120||/[\x00-\x1f\x7f<>]/.test(b.title)||typeof b.email!=='string'||b.email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(b.email))throw Error('invalid_cms_request');
 if(b.siteId!==undefined?(typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):(b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||!b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||! /\.[a-z]{2,63}$/.test(b.domain)))throw Error('invalid_cms_target');
 return b;
}
