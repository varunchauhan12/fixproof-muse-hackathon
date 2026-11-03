/** Microphone selection and safe, actionable browser errors. No audio leaves the browser. */
export async function requestVoiceInput(deviceId=''):Promise<MediaStream> {
  const audio:MediaTrackConstraints={echoCancellation:{ideal:true},noiseSuppression:{ideal:true},autoGainControl:{ideal:true},channelCount:{ideal:1}};
  if(deviceId)audio.deviceId={exact:deviceId};
  try {return await navigator.mediaDevices.getUserMedia({audio});}
  catch(error){
    // A permission/device failure must never cause a second prompt or select another mic.
    if(error && typeof error==='object' && 'name' in error && error.name==='OverconstrainedError' && !deviceId)
      return navigator.mediaDevices.getUserMedia({audio:true});
    throw error;
  }
}
export function microphoneError(error:unknown):string {
  const name=error&&typeof error==='object'&&'name' in error?error.name:'';
  if(name==='NotAllowedError'||name==='SecurityError')return 'Microphone access is blocked. Allow Microphone in this site’s browser settings and in system privacy settings, then try again. You can also type your message.';
  if(name==='NotFoundError'||name==='OverconstrainedError')return 'The selected microphone is unavailable. Choose another microphone or reconnect it, then try again.';
  if(name==='NotReadableError'||name==='AbortError')return 'The microphone could not start. Check its system input volume and close any app holding exclusive microphone access, then try again.';
  return 'Unable to start the microphone. Check the selected input and browser microphone permission, then try again.';
}
