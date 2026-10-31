// Unpublished preparation entry point. No enabled execution path exists yet.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {admitExecution} from './staging-source-admission.mjs';
import {createToolDiagnostics} from './tooling-diagnostics.mjs';
const fail=code=>{const error=Error('Source coordinator blocked');error.code=code;throw error};
export function assertSourceWorkflowIdentity(env){
 if(env.GITHUB_REPOSITORY!=='sohweiyu2023/CosmicTranscriberWeb'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_WORKFLOW!=='Bounded exact-source staging verification'||env.SOURCE_AUTHORIZATION!=='nine-new-source-existing-approval'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID||''))fail('invocation_scope_rejected');
}
export async function runSourceCoordinator(operation,env=process.env){
 if(!['preflight','prepare','execute'].includes(operation))fail('invocation_scope_rejected');
 assertSourceWorkflowIdentity(env);
 // This immutable source gate rejects before network, reservation files,
 // credential reads or provider adapters. Filling context flags cannot admit.
 admitExecution({coordinatorHead:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID});
 // Second deliberate barrier until real transport/adapters and live receipts
 // are reviewed. The protocol component is not itself an execution permit.
 fail('protocol_adapter_not_integrated');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const log=createToolDiagnostics({component:'source-admission',directory:process.env.RUNNER_TEMP?path.join(process.env.RUNNER_TEMP,'cosmic-source-tool-logs'):null,sink:event=>console.error(JSON.stringify(event))});
 log.record({operation:'source-acceptance',phase:'preflight',result:'started',errorCategory:'none'});
 try{await runSourceCoordinator(process.argv[2]);log.record({operation:'source-acceptance',phase:'finish',result:'success',errorCategory:'none',exitCode:0})}
 catch(error){log.record({operation:'source-acceptance',phase:'preflight',result:'blocked',errorCategory:['invocation_scope_rejected','execution_evidence_unpinned'].includes(error?.code)?error.code:'unknown',exitCode:1});process.exitCode=1}
 try{await writeFile('source-preparation-support.json',JSON.stringify(await log.exportSupport())+'\n',{encoding:'utf8',mode:0o600})}catch{/* Diagnostics cannot authorize execution or override a blocked outcome. */}
}
