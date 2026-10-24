import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../apps/dashboard/package.json',import.meta.url));
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('saved-login form owns visible Owner fields and enables submit without a new-install password',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'devone-reveal-ui-'));
 try{
  const source=await readFile(new URL('../apps/dashboard/src/CredentialReveal.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from (["'])(react(?:\/jsx-runtime)?)\1/g,(_,q,name)=>'from '+JSON.stringify(pathToFileURL(require.resolve(name)).href));
  const file=join(dir,'CredentialReveal.mjs');await writeFile(file,compiled);const {CredentialReveal}=await import(pathToFileURL(file).href);
  for(const product of ['devone-cms','wordpress']){
   const html=renderToStaticMarkup(React.createElement(CredentialReveal,{product,installationId:'app_0123456789abcdef',domain:'app.example.test',tls:true,onBusy:()=>{}}));
   assert.match(html,/Unlock saved login/);assert.match(html,/Panel Owner password/);assert.match(html,/MFA or recovery code/);
   assert.match(html.match(/<input[^>]*name="reveal-owner-password"[^>]*>/)?.[0]??'',/required/);
   const submit=html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];assert.ok(submit);assert.ok(!submit.includes('disabled'),'the empty required password field must focus via native form validation, rather than silently disabling Reveal');
   assert.match(html,/<form/);assert.ok(!html.includes('name="adminPassword"'),'reveal must not depend on creation credentials');
   const blocked=renderToStaticMarkup(React.createElement(CredentialReveal,{product,installationId:'app_0123456789abcdef',tls:false,onBusy:()=>{}}));
   assert.match(blocked,/HTTPS required/);assert.match(blocked,/<button[^>]*type="submit"[^>]*disabled/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
