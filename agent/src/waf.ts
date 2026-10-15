/**
 * DevOne site-specific HTTP rate protection (NGINX native module).
 * This is not a general-purpose application WAF or threat-intelligence engine.
 * Policies are strictly typed; no directives, paths, regex, or IPs come from clients.
 */
export type WafMode="off"|"monitor"|"enforce";
export type WafPolicy={mode:WafMode;requestsPerSecond:number;burst:number};
export const defaultWafPolicy:Readonly<WafPolicy>={mode:"off",requestsPerSecond:10,burst:20};
export function validateWaf(input:unknown):WafPolicy{
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("invalid_waf_policy");
 const item=input as Record<string,unknown>;
 if(Object.keys(item).some(key=>!["mode","requestsPerSecond","burst"].includes(key)))throw Error("invalid_waf_policy");
 if(!["off","monitor","enforce"].includes(item.mode as string)||
    !Number.isInteger(item.requestsPerSecond)||Number(item.requestsPerSecond)<1||Number(item.requestsPerSecond)>50||
    !Number.isInteger(item.burst)||Number(item.burst)<1||Number(item.burst)>100)
   throw Error("invalid_waf_policy");
 return {mode:item.mode as WafMode,requestsPerSecond:item.requestsPerSecond as number,burst:item.burst as number};
}
export function isValidWaf(policy:unknown):policy is WafPolicy{
 try{validateWaf(policy);return true;}catch{return false;}
}
export function nginxWafZone(siteId:string,policy:WafPolicy):string{
 if(!/^site_[a-f0-9]{16}$/.test(siteId))throw Error("invalid_site");
 if(policy.mode==="off")return "";
 return \`limit_req_zone $binary_remote_addr zone=devone_\${siteId.slice(5)}:1m rate=\${policy.requestsPerSecond}r/s;\n\`;
}
export function nginxWafLocation(siteId:string,policy:WafPolicy):string{
 if(!/^site_[a-f0-9]{16}$/.test(siteId))throw Error("invalid_site");
 if(policy.mode==="off")return "";
 return \` limit_req zone=devone_\${siteId.slice(5)} burst=\${policy.burst} nodelay;\n limit_req_status 429;\n\${policy.mode==="monitor"?" limit_req_dry_run on;\n":""}\`;
}
