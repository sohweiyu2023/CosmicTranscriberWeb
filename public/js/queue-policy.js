export const MAX_QUEUE_FILES=10_000;
export const MAX_COMBINED_FILES=1_000;

export function preparedQueueItem(item){
  return !!item && typeof item.fingerprint === "string" && /^[0-9a-f]{64}$/.test(item.fingerprint) &&
    !!item.inspection && Array.isArray(item.inspection.chunks) && item.inspection.chunks.length > 0;
}

export function eligibleQueueItem(item){
  return preparedQueueItem(item) && item.status !== "done" && item.status !== "inspecting" && item.status !== "running";
}

// Whole-file media probes use 0.001 as an internal fallback when metadata cannot
// be read. It keeps checkpoint validation stable, but is not a measured duration.
export function hasKnownDuration(item){
  return Number.isFinite(item?.duration) && item.duration>0 && (item.audioFormat==='mp3' || item.duration>0.001);
}

export function queueDurationSummary(queue){
  const summary={duration:0,unknownFiles:0};
  for(const item of queue){
    if(!preparedQueueItem(item))continue;
    if(hasKnownDuration(item))summary.duration+=item.duration;
    else summary.unknownFiles++;
  }
  return summary;
}

export function combinedExportComplete(queue){
  if(!Array.isArray(queue)) return false;
  const prepared=queue.filter(preparedQueueItem);
  if(!(prepared.length>0 && prepared.length<=MAX_COMBINED_FILES && prepared.every(item=>item.status === "done" && Array.isArray(item.parts))))return false;
  const identity=prepared[0].completedExportSettingsIdentity;
  return typeof identity === "string" && /^[0-9a-f]{64}$/.test(identity) && prepared.every(item=>item.completedExportSettingsIdentity===identity);
}

export function combinedExportHasMixedSettings(queue){
  if(!Array.isArray(queue))return false;
  const prepared=queue.filter(preparedQueueItem);
  if(!(prepared.length>1 && prepared.length<=MAX_COMBINED_FILES && prepared.every(item=>item.status === "done" && Array.isArray(item.parts))))return false;
  const identities=new Set(prepared.map(item=>item.completedExportSettingsIdentity).filter(value=>typeof value === "string" && /^[0-9a-f]{64}$/.test(value)));
  return identities.size>1 || prepared.some(item=>!item.completedExportSettingsIdentity);
}
