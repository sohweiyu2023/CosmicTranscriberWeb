// Local artifact preparation only: reuse fixed speech bytes; never synthesize,
// transcode, upload, call a provider or infer an additional media licence.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FIXTURES,verifyFixtures} from './staging-remaining-eight-policy.mjs';

const codecs={flac:['flac',16000],mp4:['aac',16000],mpeg:['mp3',16000],mpga:['mp3',16000],m4a:['aac',16000],ogg:['vorbis',16000],wav:['pcm_s16le',16000],webm:['opus',48000]};
// Exact decoded PCM16/mono/16kHz sample counts for these hash-pinned inputs.
export const DECODED_SAMPLES=Object.freeze({flac:192000,mp4:192512,mpeg:192000,mpga:192000,m4a:192512,ogg:192000,wav:240159,webm:192000});
const REASONS=new Set(['probe_streams','probe_codec','probe_rate','probe_channels','probe_size','probe_duration','probe_bits','decoded_samples','media_command','media_json']);
function requireEvidence(ok,code,format){if(!ok)throw Object.assign(new Error('Fixed fixture validation failed'),{code,format});}
export function safePreparationFailure(error){
 const code=REASONS.has(error?.code)?error.code:'fixture_identity_or_preparation';
 const format=Object.hasOwn(codecs,error?.format)?error.format:undefined;
 return {status:'FAIL',code,...(format?{format}:{}),paidRequests:0};
}
export function verifyProbe(f,p){
 requireEvidence(p.streams?.length===1,'probe_streams',f.format);const s=p.streams[0];
 requireEvidence(s.codec_type==='audio'&&s.codec_name===codecs[f.format][0],'probe_codec',f.format);
 requireEvidence(Number(s.sample_rate)===codecs[f.format][1],'probe_rate',f.format);
 requireEvidence(s.channels===1,'probe_channels',f.format);
 requireEvidence(Number(p.format?.size)===f.bytes,'probe_size',f.format);
 const duration=Number(p.format?.duration);
 // Saved FFprobe7 evidence reports12.096; the newer local probe reports12.000.
 // Accept only those observed exact representations for the
 // two fixed MP3-encoded filename cases, AND require exact decoded samples below.
 const durations=['mpeg','mpga'].includes(f.format)?[f.dispatchDurationSeconds,12]:[f.dispatchDurationSeconds];
 requireEvidence(Number.isFinite(duration)&&durations.some(expected=>Math.abs(duration-expected)<=0.001),'probe_duration',f.format);
 if(f.format==='wav')requireEvidence(s.bits_per_sample===16,'probe_bits',f.format);
 return {format:f.format,name:f.name,bytes:f.bytes,sha256:f.sha256,durationSeconds:duration,codec:s.codec_name,sampleRate:Number(s.sample_rate),channels:s.channels,decode:'PASS'};
}
export function verifyDecodedSamples(f,pcm){
 requireEvidence(Buffer.isBuffer(pcm)&&pcm.length===DECODED_SAMPLES[f.format]*2,'decoded_samples',f.format);
 return pcm.length/2;
}
function command(run,exe,args,{binary=false,format}={}){
 const r=run(exe,args,{encoding:binary?null:'utf8',stdio:'pipe',timeout:30000,killSignal:'SIGKILL',maxBuffer:binary?524288:131072});
 requireEvidence(!r.error&&r.status===0,'media_command',format);return r.stdout;
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
  let p;try{p=JSON.parse(command(run,ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,size:stream=codec_type,codec_name,sample_rate,channels,bits_per_sample','-of','json',file],{format:f.format}));}catch(error){if(error?.code==='media_command')throw error;requireEvidence(false,'media_json',f.format);}
  const row=verifyProbe(f,p);
  const pcm=command(run,ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-f','s16le','-c:a','pcm_s16le','-ac','1','-ar','16000','-'],{binary:true,format:f.format});
  row.decodedSamples=verifyDecodedSamples(f,pcm);rows.push(row);
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
 catch(error){console.error(JSON.stringify(safePreparationFailure(error)));process.exitCode=1;}
}
