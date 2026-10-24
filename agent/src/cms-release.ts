import {validAdminUsername,validAdminPassword} from './install-account.js';
// Prebuilt from the reviewed, tested CMS source commit; no npm/build on the VPS.
export const cmsRelease={version:'2.0.0-alpha.5',sourceRepository:'developeronesw/DevOneCMS-v2',sourceCommit:'b9675b1b1f3f4b46f7c7b86709ec9cc55e850bb1',sha256:'53fae55d4a673a84042c5d606ce3181cd46562ad16c2dbd4060484ed3df52244',file:'2.0.0-alpha.5.tar.gz',bytes:109213,preview:true} as const;
export type CmsInstall={id:string;adminPassword:string;adminUsername?:string;deployment?:'local';title:string;email:string;siteId?:string;domain?:string;expectedRevision?:number};
export function cmsInput(value:unknown):CmsInstall{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_cms_request');
 const b=value as CmsInstall;
 if(b.adminUsername!==undefined&&!validAdminUsername(b.adminUsername))throw Error('invalid_administrator_account');
 if(b.deployment!==undefined&&b.deployment!=='local')throw Error('cms_local_deployment_required');
 if(Object.keys(b).some(k=>!['id','adminPassword','adminUsername','deployment','title','email','siteId','domain','expectedRevision'].includes(k))||!/^app_[a-f0-9]{16}$/.test(b.id)||!validAdminPassword(b.adminPassword)||typeof b.title!=='string'||b.title.trim()!==b.title||b.title.length<2||b.title.length>120||/[\x00-\x1f\x7f<>]/.test(b.title)||typeof b.email!=='string'||b.email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(b.email))throw Error('invalid_cms_request');
 if(b.siteId!==undefined?(typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):(b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||!b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||! /\.[a-z]{2,63}$/.test(b.domain)))throw Error('invalid_cms_target');
 return b;
}
