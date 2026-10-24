import {validAdminUsername,validAdminPassword} from './install-account.js';
// Reviewed WordPress.org artifact; changes require a new digest and real install QA.
export const wordpressRelease={version:'7.1.3',url:'https://wordpress.org/wordpress-7.1.3.tar.gz',sha256:'d2a09acb6a15e3b9c471d72557753c266d6f41a79ed19bfe04cbfe49e283b2a5',maxBytes:64*1024*1024} as const;
export type WordPressInstall={id:string;databaseId:string;databasePassword:string;adminPassword:string;adminUsername?:string;email:string;title:string;siteId?:string;domain?:string;expectedRevision?:number};
export function wordpressInput(value:unknown):WordPressInstall{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_wordpress_request');
 const b=value as WordPressInstall;
 if(b.adminUsername!==undefined&&!validAdminUsername(b.adminUsername))throw Error('invalid_administrator_account');
 if(Object.keys(b).some(k=>!['id','databaseId','databasePassword','adminPassword','adminUsername','email','title','siteId','domain','expectedRevision'].includes(k))||!/^app_[a-f0-9]{16}$/.test(b.id)||!/^db_[a-f0-9]{16}$/.test(b.databaseId)||!/^([a-f0-9]{64})$/.test(b.databasePassword)||!validAdminPassword(b.adminPassword)||typeof b.title!=='string'||b.title.trim()!==b.title||b.title.length<1||b.title.length>120||/[\x00-\x1f\x7f<>]/.test(b.title)||typeof b.email!=='string'||b.email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(b.email))throw Error('invalid_wordpress_request');
 if(b.siteId!==undefined?(typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):(b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||!b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||! /\.[a-z]{2,63}$/.test(b.domain)))throw Error('invalid_wordpress_target');
 return b;
}
