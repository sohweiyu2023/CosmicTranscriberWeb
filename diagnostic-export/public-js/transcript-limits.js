export const MAX_TRANSCRIPT_CHARACTERS_PER_FILE=25_000_000;

export function addTranscriptCharacters(total,text,{label='The transcript'}={}){
  const current=Number(total);
  const value=typeof text==='string'?text:'';
  if(!Number.isSafeInteger(current)||current<0)throw new Error('Transcript character counter is invalid.');
  if(value.length>MAX_TRANSCRIPT_CHARACTERS_PER_FILE-current)throw new Error(`${label} exceeded the safe ${MAX_TRANSCRIPT_CHARACTERS_PER_FILE.toLocaleString('en-US')}-character in-memory limit. Split the source recording into smaller files and retry; completed chunk checkpoints were retained.`);
  return current+value.length;
}

export function combinedTranscriptWithinLimit(items){
  let total=0;
  for(const item of items||[])for(const part of item?.parts||[]){
    const text=typeof part?.text==='string'?part.text:'';
    if(text.length>MAX_TRANSCRIPT_CHARACTERS_PER_FILE-total)return false;
    total+=text.length;
  }
  return true;
}
