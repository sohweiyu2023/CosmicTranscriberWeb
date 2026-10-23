// Bounded Linux CI media provisioning; validation remains mandatory.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const ENCODERS=['libmp3lame','flac','aac','libvorbis','pcm_s16le','libopus'];
export const DECODER_GROUPS=[['mp3','mp3float'],['flac'],['aac','aac_fixed'],['vorbis','libvorbis'],['opus','libopus'],['pcm_s16le']];
const aptOptions=['-o','Acquire::Retries=2','-o','Acquire::http::Timeout=20','-o','Acquire::https::Timeout=20','-o','DPkg::Lock::Timeout=30'];
const MIRROR_FILE='/etc/apt/apt-mirrors.txt';
const REVIEWED_MIRRORS=['http://azure.archive.ubuntu.com/ubuntu/','https://archive.ubuntu.com/ubuntu/','https://security.ubuntu.com/ubuntu/'];
// GitHub's image already configures these official fallbacks. A slowly trickling
// Azure transfer does not trip APT's idle timeout; prefer the existing archive.
// Never edit sources, keyrings or trust options, or accept an unknown mirror list.
export function reviewedMirrorList(text){
 assert.equal(typeof text,'string');assert.ok(text.length<4096);
 const lines=text.trim().split(/\r?\n/);assert.equal(lines.length,3);
 const actual=lines.map(line=>{const match=/^(\S+)[\t ]+priority:([123])$/.exec(line);assert.ok(match);return [match[1],Number(match[2])];});
 assert.deepEqual(actual.map(x=>x[0]).sort(),[...REVIEWED_MIRRORS].sort());
 assert.deepEqual(actual.map(x=>x[1]).sort(),[1,2,3]);
 return `${REVIEWED_MIRRORS[1]}\tpriority:1\n${REVIEWED_MIRRORS[0]}\tpriority:2\n${REVIEWED_MIRRORS[2]}\tpriority:3\n`;
}
export function preferOfficialMirror(run,{env=process.env,read=readFileSync}={}){
 if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.RUNNER_OS!=='Linux')return false;
 const before=read(MIRROR_FILE,'utf8'),after=reviewedMirrorList(before);
 if(before!==after){const r=run('sudo',['-n','tee',MIRROR_FILE],{input:after,encoding:'utf8',stdio:['pipe','ignore','pipe'],timeout:10000,killSignal:'SIGKILL',maxBuffer:4096});
  assert.ok(!r.error&&r.status===0,'Could not prefer the reviewed official Ubuntu archive');}
 return true;
}
export function aptPlan(){return [
 {command:'timeout',args:['--kill-after=10s','180s','sudo','-n','env','DEBIAN_FRONTEND=noninteractive','apt-get',...aptOptions,'-o','APT::Update::Error-Mode=any','update'],timeout:200000},
 {command:'timeout',args:['--kill-after=10s','240s','sudo','-n','env','DEBIAN_FRONTEND=noninteractive','apt-get',...aptOptions,'install','-y','--no-install-recommends','ffmpeg'],timeout:260000}
];}
export function hasCapabilities(text,groups){
 const names=new Set(String(text).split('\n').map(line=>/^\s*[A-Z.]{6}\s+(\S+)\s/.exec(line)?.[1]).filter(Boolean));
 return groups.every(group=>group.some(name=>names.has(name)));
}
export function probe(run,log=()=>{}){
 const options={encoding:'utf8',stdio:'pipe',timeout:10000};
 const versions={};for(const command of ['ffmpeg','ffprobe']){const r=run(command,['-version'],options);if(r.error||r.status!==0)return false;versions[command]=String(r.stdout).split('\n')[0].slice(0,200);}
 const enc=run('ffmpeg',['-hide_banner','-encoders'],options),dec=run('ffmpeg',['-hide_banner','-decoders'],options);
 const verified=!enc.error&&!dec.error&&enc.status===0&&dec.status===0&&hasCapabilities(enc.stdout,ENCODERS.map(x=>[x]))&&hasCapabilities(dec.stdout,DECODER_GROUPS);
 if(verified)log(JSON.stringify({mediaToolchain:'verified',versions,requiredEncoders:ENCODERS,requiredDecoderGroups:DECODER_GROUPS}));return verified;
}
export function provision(run=spawnSync,platform=process.platform,log=console.log,options={}){
 assert.equal(platform,'linux','This provisioner is only for Linux CI');
 if(probe(run,log)){log('MEDIA_PROVISION existing tools and required codecs verified');return 'existing';}
 if(preferOfficialMirror(run,options))log('MEDIA_PROVISION official Ubuntu archive preferred on hosted Linux runner');
 log('MEDIA_PROVISION bounded APT installation required');
 for(const step of aptPlan()){
  const r=run(step.command,step.args,{stdio:'inherit',timeout:step.timeout,killSignal:'SIGKILL',env:{...process.env,DEBIAN_FRONTEND:'noninteractive'}});
  assert.ok(!r.error&&r.status===0,'Bounded APT provisioning failed; validation remains required');
 }
 assert.ok(probe(run,log),'Installed ffmpeg/ffprobe codec checks failed');
 log('MEDIA_PROVISION installed tools and required codecs verified');return 'installed';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{provision()}catch{console.error('MEDIA_PROVISION FAIL: bounded provisioning or codec verification failed; no validation gate skipped');process.exitCode=1}
}
