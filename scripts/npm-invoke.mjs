import {spawnSync} from 'node:child_process';

export function npmInvocation(args,{npmExecPath=process.env.npm_execpath,platform=process.platform,nodeExecPath=process.execPath}={}){
  if(typeof npmExecPath==='string'&&npmExecPath){
    return {command:nodeExecPath,args:[npmExecPath,...args],shell:false};
  }
  return {command:platform==='win32'?'npm.cmd':'npm',args:[...args],shell:platform==='win32'};
}

export function invokeNpm(args,{cwd=process.cwd(),stdio='inherit',env=process.env}={}){
  const plan=npmInvocation(args,{npmExecPath:env.npm_execpath});
  const result=spawnSync(plan.command,plan.args,{cwd,stdio,env,shell:plan.shell});
  if(result.error){
    console.error(`Unable to start npm ${args.join(' ')}: ${result.error.message}`);
    return {status:1,error:result.error};
  }
  return result;
}
