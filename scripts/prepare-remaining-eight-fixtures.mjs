// Local artifact preparation only: reuse fixed speech bytes; never synthesize,
// transcode, upload, call a provider or infer an additional media licence.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FIXTURES,verifyFixtures} from './staging-remaining-eight-policy.mjs';

const codecs={flac:['flac',16000],mp4:['aac',16000],mpeg:['mp3',16000],mpga:['mp3',16000],m4a:['aac',16000],ogg:['vorbis',16000],wav:['pcm_s16le',16000],webm:['opus',48000]};
export function verifyProbe(f,p){
 assert.equal(p.streams?.length,1);const s=p.streams[0];
 assert.equal(s.codec_type,'audio');assert.equal(s.codec_name,codecs[f.format][0]);
 assert.equal(Number(s.sample_rate),codecs[f.format][1]);assert.equal(s.channels,1);
 assert.equal(Number(p.format?.size),f.bytes);
 const duration=Number(p.format?.duration);assert.ok(Number.isFinite(duration)&&Math.abs(duration-f.dispatchDurationSeconds)<=0.001);
 if(f.format==='wav')assert.equal(s.bits_per_sample,16);
 return {format:f.format,name:f.name,bytes:f.bytes,sha256:f.sha256,durationSeconds:duration,codec:s.codec_name,sampleRate:Number(s.sample_rate),channels:s.channels,decode:'PASS'};
}
function command(run,exe,args){
 const r=run(exe,args,{encoding:'utf8',stdio:'pipe',timeout:30000,killSignal:'SIGKILL',maxBuffer:131072});
 assert.ok(!r.error&&r.status===0,'Offline media validation failed');return r.stdout;
}
export async function prepareFixtures(sourceRoot,outputRoot,{run=spawnSync,ffmpeg='ffmpeg',ffprobe='ffprobe'}={}){
 const source=path.resolve(sourceRoot),output=path.resolve(outputRoot);
 assert.notEqual(source,output);assert.equal(FIXTURES.length,8);assert.equal(FIXTURES.some(f=>f.format==='mp3'),false);
 const bytes=Object.create(null);
 for(const f of FIXTURES){const file=path.join(source,f.name);assert.equal((await lstat(file)).isFile(),true);bytes[f.name]=await readFile(file);}
 verifyFixtures(bytes);
 const versions={ffmpeg:command(run,ffmpeg,['-version']).split(/\r?\n/,1)[0].slice(0,200),ffprobe:command(run,ffprobe,['-version']).split(/\r?\n/,1)[0].slice(0,200)};
 const rows=[];
 for(const f of FIXTURES){
  const file=path.join(source,f.name);
  const p=JSON.parse(command(run,ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,size:stream=codec_type,codec_name,sample_rate,channels,bits_per_sample','-of','json',file]));
  const row=verifyProbe(f,p);
  command(run,ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-f','null','-']);rows.push(row);
 }
 // Existing outputs are never overwritten. Validate everything before creating.
 await mkdir(output);const files=path.join(output,'files');await mkdir(files);
 for(const f of FIXTURES)await writeFile(path.join(files,f.name),bytes[f.name],{flag:'wx'});
 const copied=Object.create(null);for(const entry of await readdir(files,{withFileTypes:true})){assert.equal(entry.isFile(),true);copied[entry.name]=await readFile(path.join(files,entry.name));}verifyFixtures(copied);
 const receipt={schema:'cosmic-remaining-eight-local-producer-1',status:'READY_LOCAL_NOT_UPLOADED',artifactName:'cosmic-approved-remaining-eight-fixtures',fileCount:8,files:rows,versions,sourceWavSha256:FIXTURES.find(f=>f.format==='wav').sha256,includesCompletedMp3:false,generatedSpeech:false,reencoded:false,uploaded:false,paidRequests:0,additionalMediaLicenceAssumed:false,rootMitCoversAudio:false};
 await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{assert.equal(process.argv.length,4);const receipt=await prepareFixtures(process.argv[2],process.argv[3]);console.log(JSON.stringify({status:receipt.status,files:receipt.fileCount,paidRequests:0}));}
 catch{console.error('FIXTURE_PREPARATION FAILED; no upload or provider call performed');process.exitCode=1;}
}
