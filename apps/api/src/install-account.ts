import {createHash,timingSafeEqual} from 'node:crypto';
export function validInstallAccount(b:Record<string,unknown>){return typeof b.adminUsername==='string'&&/^[a-z0-9][a-z0-9._-]{2,59}$/.test(b.adminUsername)&&typeof b.adminPassword==='string'&&b.adminPassword.length>=12&&b.adminPassword.length<=128&&!/[\x00-\x1f\x7f]/.test(b.adminPassword)&&b.adminPasswordConfirm===b.adminPassword;}
export function sameInstallPassword(a:string|null|undefined,b:string){return typeof a==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
