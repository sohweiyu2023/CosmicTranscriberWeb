import {hashText} from "./hash.js";
import {CHECKPOINT_SCHEMA,validateCheckpointShape} from "./checkpoint-schema.js";
export {CHECKPOINT_SCHEMA,validateCheckpointShape} from "./checkpoint-schema.js";

const DB_NAME="cosmic-transcriber-web";
const DB_VERSION=1;
const STORE="checkpoints";

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function stable(v){if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(",")}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`}
async function integrity(record){const clone=structuredClone(record);delete clone.integrity;return hashText(stable(clone))}

export async function loadCheckpoint(id){
  const db=await openDb();
  try{
    const record=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),r=tx.objectStore(STORE).get(id);let settled=false;const done=fn=>value=>{if(settled)return;settled=true;fn(value)};r.onsuccess=done(()=>resolve(r.result||null));r.onerror=done(()=>reject(r.error));tx.onabort=done(()=>reject(tx.error||new Error("Checkpoint read transaction aborted.")))});
    if(!record)return null;
    if(!validateCheckpointShape(record))throw new Error("Checkpoint schema validation failed.");
    if(record.integrity!==await integrity(record))throw new Error("Checkpoint integrity validation failed.");
    return record;
  }finally{db.close()}
}
export async function saveCheckpoint(record){
  const clean=structuredClone(record);delete clean.integrity;clean.schema=CHECKPOINT_SCHEMA;clean.updatedAt=new Date().toISOString();
  if(!validateCheckpointShape(clean,{requireIntegrity:false}))throw new Error("Checkpoint schema validation failed before save.");
  clean.integrity=await integrity(clean);
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(clean);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Checkpoint write transaction aborted."))});return clean}finally{db.close()}
}
export async function deleteCheckpoint(id){const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Checkpoint delete transaction aborted."))})}finally{db.close()}}
export async function checkpointId(principalScope,sourceFingerprint,settingsIdentity){return `cp:${hashText(`${CHECKPOINT_SCHEMA}|${principalScope}|${sourceFingerprint}|${settingsIdentity}`)}`}
export function settingsIdentity(settings,chunkerRevision){const safe={model:settings.model,languages:settings.languages,keywords:settings.keywords,prompt:settings.prompt,chunkMb:settings.chunkMb,maxMinutes:settings.maxMinutes,previousContext:settings.previousContext,chunkerRevision};return hashText(stable(safe))}
