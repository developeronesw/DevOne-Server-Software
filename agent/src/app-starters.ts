// Versioned built-in applications: no remote scripts or root package lifecycle hooks.
export const appStarters = [
 {id:"static-starter",name:"Static website",siteType:"static",version:"1.0.0",entry:"index.html"},
 {id:"php-starter",name:"PHP website",siteType:"php",runtimeVersion:"8.3",version:"1.0.0",entry:"index.php"},
 {id:"node-starter",name:"Node.js HTTP app",siteType:"node",runtimeVersion:"22",version:"1.0.0",entry:"server.mjs"}
] as const;
export function starter(id:unknown){const app=appStarters.find(a=>a.id===id);if(!app)throw Error("unsupported_app");return app;}
export function starterSource(id:unknown):string{
 const app=starter(id);
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your DevOne website</title><style>body{font:18px system-ui;background:#f6f8fc;color:#17243b;max-width:760px;margin:15vh auto;padding:32px}small{color:#376bc8}h1{font-size:48px}</style><small>POWERED BY DEVONE</small><h1>Your website is ready.</h1><p>Open Websites &amp; files to start building.</p></html>';
 if(app.siteType==='php')return '<?php header("X-Content-Type-Options: nosniff"); ?>\n'+html;
 if(app.siteType==='node')return 'import {createServer} from "node:http";\nconst page='+JSON.stringify(html)+';\ncreateServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff"});res.end(page);}).listen(Number(process.env.PORT),"127.0.0.1");\n';
 return html;
}
