import {AssertionError} from 'node:assert';

// Only errors minted here can contribute a receipt diagnostic. Do not copy
// arbitrary error properties, messages, provider values or transcript content.
const allowed=new Set([
 'result_missing','result_structure_invalid','diagnostics_missing',
 'diarization_duration_invalid','diarization_text_missing','diarization_segments_missing',
 'diarization_speaker_missing','diarization_segment_text_missing',
 'diarization_timestamps_invalid','diarization_order_invalid','diarization_speakers_insufficient',
 'speech_text_missing','speech_content_insufficient'
]);
const failures=new WeakMap();
export function acceptanceAssertion(code,message){
 if(!allowed.has(code))throw new TypeError('Unknown acceptance diagnostic');
 const error=new AssertionError({message,operator:'==',actual:false,expected:true});
 failures.set(error,code);
 return error;
}
export function acceptanceFailureDetails(error){
 const code=error!==null&&(typeof error==='object'||typeof error==='function')?failures.get(error):undefined;
 return code===undefined?{}:{validationFailure:code};
}
