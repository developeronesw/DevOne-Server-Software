import type {DatabaseSync} from "node:sqlite";
import {createHmac,createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {readMasterKey,seal,open} from "./vault.js";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(data:Buffer):string{
 let bits=0,carry=0,result="";
 for(const byte of data){carry=(carry<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(carry>>>(bits-=5))&31];}}
 if(bits>0)result+=alphabet[(carry<<(5-bits))&31];
 return result;
}
export function fromBase32(secret:string):Buffer{
 if(!/^[A-Z2-7]{32}$/.test(secret))throw Error("invalid_totp_secret");
 let bits=0,carry=0;const result:number[]=[];
 for(const char of secret){carry=(carry<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){result.push((carry>>>(bits-=8))&255);}}
 return Buffer.from(result);
}
export function totpAt(secret:string,counter:number):string{
 if(!Number.isSafeInteger(counter)||counter<0)throw Error("invalid_counter");
 const input=Buffer.alloc(8);input.writeBigUInt64BE(BigInt(counter));
 const digest=createHmac("sha1",fromBase32(secret)).update(input).digest();
 const start=digest[digest.length-1]&15;
 const value=(digest.readUInt32BE(start)&0x7fffffff)%1000000;
 return String(value).padStart(6,"0");
}
export function matchTotp(secret:string,code:unknown,lastCounter=-1,now=Date.now()):number|null{
 if(typeof code!=="string"||!/^[0-9]{6}$/.test(code))return null;
 const counter=Math.floor(now/30000);
 for(const c of [counter-1,counter,counter+1]){
  if(c<0||c<=lastCounter)continue;
  const expected=Buffer.from(totpAt(secret,c)),actual=Buffer.from(code);
  if(timingSafeEqual(expected,actual))return c;
 }
 return null;
}
type Row={user_id:string;encrypted_secret:string;enabled:number;last_counter:number;backup_hashes:string;pending_expires:number};
const digest=(code:string)=>createHash("sha256").update("devone-mfa-recovery-v1:"+code).digest("hex");
function recoveryValid(code:unknown){return typeof code==="string"&&/^[0-9a-f]{8}-[0-9a-f]{8}$/.test(code);}
export class MfaService{
 constructor(private db:DatabaseSync,private keyPath:string){
  db.exec("CREATE TABLE IF NOT EXISTS owner_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,encrypted_secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,backup_hashes TEXT NOT NULL DEFAULT '[]',pending_expires INTEGER NOT NULL DEFAULT 0)");
 }
 private row(userId:string){
  return this.db.prepare("SELECT * FROM owner_mfa WHERE user_id=?").get(userId) as Row|undefined;
 }
 status(userId:string){
  const row=this.row(userId);
  return {enabled:row?.enabled===1,pending:row?.enabled===0&&row.pending_expires>Date.now(),remainingRecoveryCodes:row?.enabled===1?(JSON.parse(row.backup_hashes) as string[]).length:0};
 }
 private secret(userId:string,row:Row){
  return open(readMasterKey(this.keyPath),"mfa."+userId,row.encrypted_secret);
 }
 begin(userId:string,email:string){
  const row=this.row(userId);
  if(row?.enabled===1)throw Error("mfa_already_enabled");
  const secret=base32(randomBytes(20));
  const envelope=seal(readMasterKey(this.keyPath),"mfa."+userId,secret);
  this.db.prepare("INSERT INTO owner_mfa(user_id,encrypted_secret,enabled,last_counter,backup_hashes,pending_expires) VALUES(?,?,0,-1,'[]',?) ON CONFLICT(user_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,enabled=0,last_counter=-1,backup_hashes='[]',pending_expires=excluded.pending_expires").run(userId,envelope,Date.now()+10*60000);
  return {manualKey:secret,otpauthUrl:"otpauth://totp/"+encodeURIComponent("DevOne Server:"+email)+"?secret="+secret+"&issuer="+encodeURIComponent("DevOne Server")+"&algorithm=SHA1&digits=6&period=30",expiresInSeconds:600};
 }
 confirm(userId:string,code:unknown){
  const row=this.row(userId);
  if(!row||row.enabled!==0||row.pending_expires<=Date.now())throw Error("mfa_setup_expired");
  const secret=this.secret(userId,row);
  const counter=matchTotp(secret,code);
  if(counter===null)throw Error("invalid_mfa_code");
  const codes=Array.from({length:8},()=>randomBytes(8).toString("hex").replace(/^(.{8})(.{8})$/,"$1-$2"));
  this.db.prepare("UPDATE owner_mfa SET enabled=1,last_counter=?,backup_hashes=?,pending_expires=0 WHERE user_id=?").run(counter,JSON.stringify(codes.map(digest)),userId);
  return codes;
 }
 verifyLogin(userId:string,code:unknown):boolean{
  const row=this.row(userId);
  if(!row||row.enabled!==1)return true;
  if(typeof code!=="string")return false;
  const secret=this.secret(userId,row);
  const counter=matchTotp(secret,code,row.last_counter);
  if(counter!==null){
   this.db.prepare("UPDATE owner_mfa SET last_counter=? WHERE user_id=? AND last_counter<?").run(counter,userId,counter);
   return true;
  }
  if(!recoveryValid(code))return false;
  const hash=digest(code),hashes=JSON.parse(row.backup_hashes) as string[];
  const index=hashes.findIndex(item=>/^[0-9a-f]{64}$/.test(item)&&timingSafeEqual(Buffer.from(item,"hex"),Buffer.from(hash,"hex")));
  if(index===-1)return false;
  hashes.splice(index,1);
  this.db.prepare("UPDATE owner_mfa SET backup_hashes=? WHERE user_id=?").run(JSON.stringify(hashes),userId);
  return true;
 }
 disable(userId:string,code:unknown){
  const row=this.row(userId);
  if(!row||row.enabled!==1)throw Error("mfa_not_enabled");
  if(!this.verifyLogin(userId,code))throw Error("invalid_mfa_code");
  this.db.prepare("DELETE FROM owner_mfa WHERE user_id=?").run(userId);
 }
}
