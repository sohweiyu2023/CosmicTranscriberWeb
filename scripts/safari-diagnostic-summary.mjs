import {open,readdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

// Never publish raw SafariDriver logs: they can contain URLs, file paths,
// identifiers, or other session data. Export only bounded keyword counts.
const LOG_DIRECTORY=path.join(homedir(),'Library','Logs','com.apple.WebDriver');
const PATTERNS=Object.freeze({
  notReadableError:/NotReadableError/gi,
  sandbox:/sandbox/gi,
  permission:/permission/gi,
  denied:/denied|deny/gi,
  fileRead:/file.{0,16}(?:read|access)|(?:read|access).{0,16}file/gi
});

export async function summarizeSafariDiagnostics({directory=LOG_DIRECTORY,since=0}={}){
  const summary={available:false,filesFound:0,filesInspected:0,bytesInspected:0,
    counts:Object.fromEntries(Object.keys(PATTERNS).map(key=>[key,0]))};
  try{
    const entries=await readdir(directory,{withFileTypes:true});
    const candidates=[];
    const earliest=Number(new Date(since))||0;
    for(const entry of entries){
      if(!entry.isFile())continue; // Never follow symlinks.
      const file=path.join(directory,entry.name);
      const info=await stat(file);
      if(info.mtimeMs<earliest-30_000)continue;
      candidates.push({file,mtimeMs:info.mtimeMs});
    }
    candidates.sort((a,b)=>b.mtimeMs-a.mtimeMs);
    summary.available=true;summary.filesFound=candidates.length;
    for(const candidate of candidates.slice(0,16)){
      const fd=await open(candidate.file,'r');
      try{
        const buffer=Buffer.alloc(512*1024);
        const {bytesRead}=await fd.read(buffer,0,buffer.length,0);
        summary.filesInspected++;summary.bytesInspected+=bytesRead;
        const excerpt=buffer.toString('utf8',0,bytesRead);
        for(const [key,pattern] of Object.entries(PATTERNS)){
          summary.counts[key]+=(excerpt.match(pattern)||[]).length;
        }
      }finally{await fd.close()}
    }
  }catch(error){
    summary.available=false;
    summary.errorCode=/^[A-Z0-9_]+$/.test(String(error?.code))?error.code:'UNKNOWN';
  }
  return summary;
}
