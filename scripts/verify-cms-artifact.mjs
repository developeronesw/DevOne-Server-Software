import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cmsRelease} from '../agent/dist/cms-release.js';
const bytes=readFileSync(new URL('../distributions/devone-cms-local/'+cmsRelease.file,import.meta.url));
if(bytes.length!==cmsRelease.bytes||createHash('sha256').update(bytes).digest('hex')!==cmsRelease.sha256)throw Error('CMS artifact integrity failed');
if(!/^[a-f0-9]{40}$/.test(cmsRelease.sourceCommit)||cmsRelease.sourceRepository!=='developeronesw/DevOneCMS-v2'||cmsRelease.preview!==true)throw Error('CMS release metadata invalid');
console.log('Verified prebuilt CMS preview artifact from '+cmsRelease.sourceCommit);
