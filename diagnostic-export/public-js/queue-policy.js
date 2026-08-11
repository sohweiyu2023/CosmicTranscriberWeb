export const MAX_QUEUE_FILES=10_000;
export const MAX_COMBINED_FILES=1_000;

export function preparedQueueItem(item){
  return !!item && typeof item.fingerprint === "string" && /^[0-9a-f]{64}$/.test(item.fingerprint) &&
    !!item.inspection && Array.isArray(item.inspection.chunks) && item.inspection.chunks.length > 0;
}

export function eligibleQueueItem(item){
  return preparedQueueItem(item) && item.status !== "done" && item.status !== "inspecting" && item.status !== "running";
}

export function combinedExportComplete(queue){
  if(!Array.isArray(queue)) return false;
  const prepared=queue.filter(preparedQueueItem);
  if(!(prepared.length>0 && prepared.length<=MAX_COMBINED_FILES && prepared.every(item=>item.status === "done" && Array.isArray(item.parts))))return false;
  const identity=prepared[0].completedSettingsIdentity;
  return typeof identity === "string" && /^[0-9a-f]{64}$/.test(identity) && prepared.every(item=>item.completedSettingsIdentity===identity);
}

export function combinedExportHasMixedSettings(queue){
  if(!Array.isArray(queue))return false;
  const prepared=queue.filter(preparedQueueItem);
  if(!(prepared.length>1 && prepared.length<=MAX_COMBINED_FILES && prepared.every(item=>item.status === "done" && Array.isArray(item.parts))))return false;
  const identities=new Set(prepared.map(item=>item.completedSettingsIdentity).filter(value=>typeof value === "string" && /^[0-9a-f]{64}$/.test(value)));
  return identities.size>1 || prepared.some(item=>!item.completedSettingsIdentity);
}
