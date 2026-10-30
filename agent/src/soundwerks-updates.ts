// Official Creative Soundwerks update channel. Never accept a repo URL,
 // branch, shell command, or unverified build from browser input.
export const CSW_REPO='developeronesw/CreativeSoundwerks2';
export const CSW_SOURCE='https://github.com/developeronesw/CreativeSoundwerks2.git';
const API='https://api.github.com/repos/'+CSW_REPO;
const SHA=/^[a-f0-9]{40}$/;
type Run={id:number;name:string;head_sha:string;head_branch:string;event:string;status:string;conclusion:string|null};
export type SoundwerksReleaseCheck={
 latestSha:string;approved:boolean;checks:string;workflowUrl:string|null;
};
export type GitHubFetcher=(path:string)=>Promise<unknown>;
async function github(path:string){
 const response=await fetch(API+path,{redirect:'error',signal:AbortSignal.timeout(9000),
  headers:{'Accept':'application/vnd.github+json','User-Agent':'DevOne-CreativeSoundwerks-Updater',
  'X-GitHub-Api-Version':'2022-11-28'}});
 if(!response.ok)throw Error(response.status===403||response.status===429?'github_rate_limited':'github_unavailable');
 return response.json();
}
export async function checkSoundwerksRelease(fetcher:GitHubFetcher=github):Promise<SoundwerksReleaseCheck>{
 const head=await fetcher('/git/ref/heads/main') as {object?:{sha?:unknown}};
 const sha=head?.object?.sha;
 if(typeof sha!=='string'||!SHA.test(sha))throw Error('soundwerks_invalid_remote_revision');
 const response=await fetcher('/actions/runs?head_sha='+sha+'&per_page=30') as {workflow_runs?:Run[]};
 if(!Array.isArray(response.workflow_runs))throw Error('soundwerks_ci_unavailable');
 const matches=response.workflow_runs.filter(run=>
  run&&run.name==='Creative Soundwerks CI'&&run.head_sha===sha&&
  run.head_branch==='main'&&run.event==='push'&&Number.isSafeInteger(run.id)&&run.id>0);
 // Fail closed if there is no single unambiguous run for this exact main SHA.
 const approved=matches.length===1&&matches[0].status==='completed'&&matches[0].conclusion==='success';
 return {latestSha:sha,approved,checks:matches.length===1?matches[0].status+'/'+matches[0].conclusion:'unverified',
  workflowUrl:matches.length===1?'https://github.com/'+CSW_REPO+'/actions/runs/'+matches[0].id:null};
}
export function assertSoundwerksTarget(value:unknown):string{
 if(typeof value!=='string'||!SHA.test(value))throw Error('invalid_soundwerks_update_target');
 return value;
}
export async function verifySoundwerksTarget(target:unknown,fetcher:GitHubFetcher=github){
 const sha=assertSoundwerksTarget(target);
 const release=await checkSoundwerksRelease(fetcher);
 if(!release.approved)throw Error('soundwerks_release_checks_not_passed');
 if(release.latestSha!==sha)throw Error('soundwerks_update_target_changed');
 return release;
}
