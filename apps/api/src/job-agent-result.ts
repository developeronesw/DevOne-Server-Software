import {OutcomeUnknown} from "./jobs.js";
import {isSafeInstallFailureReason} from "./software-reasons.js";

// A response received from the Agent can distinguish an acknowledged
// installation failure from a lost/unknown transport outcome.
export async function assertAgentMutationResult(response:Response,operation:string):Promise<void>{
 if(response.ok)return;
 const payload=await response.json().catch(()=>({})) as {error?:unknown;reason?:unknown};
 if(operation==="wordpress.install"&&["software_install_requires_inspection","site_provisioning_requires_inspection","domain_in_use","site_limit","php83_runtime_not_running","wordpress_install_requires_inspection","wordpress_prerequisites_unavailable","wordpress_artifact_unavailable","wordpress_already_recorded","app_target_not_empty","app_target_incompatible","site_revision_conflict"].includes(payload.error as string))throw Error(payload.error as string);
 if(operation==="software.install"&&response.status===503&&
    payload.error==="software_install_requires_inspection"){
  throw Error("software_install_"+(isSafeInstallFailureReason(payload.reason)?payload.reason:"unclassified"));
 }
 if(operation==="app.install"&&payload.error==="app_install_requires_inspection")throw Error("app_install_requires_inspection");
 if(operation==="app.install"&&["app_target_not_empty","app_target_incompatible","site_revision_conflict"].includes(payload.error as string))throw Error(payload.error as string);
 if(operation==="database.create"&&["database_provisioning_requires_inspection","database_engine_unavailable","database_credentials_missing","database_site_not_ready","database_already_recorded","database_limit"].includes(payload.error as string))throw Error(payload.error as string);
 if(response.status>=500)throw new OutcomeUnknown("agent_outcome_unknown");
 const safe=new Set(["runtime_entry_missing","runtime_not_healthy","node_entry_missing","site_runtime_not_available","php83_runtime_not_running","node22_runtime_not_available","site_port_unavailable","unsupported_runtime_version","python312_runtime_not_available","docker_runtime_not_running"]);
 if((operation==="site.action"||operation==="site.create")&&safe.has(payload.error as string))throw Error(payload.error as string);
 throw Error("agent_operation_failed");
}
