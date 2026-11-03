/** Capture locally. Prefer a labelled built-in Mac input over a headset/default alias. */
export function builtInMicrophone(devices:MediaDeviceInfo[]):MediaDeviceInfo|undefined {
  return devices.find(device=>device.kind==='audioinput' && !['default','communications'].includes(device.deviceId)
    && /macbook|imac|built[ -]?in|internal microphone|internes mikrofon|microphone interne|micrófono integrado/i.test(device.label)
    && !/headset|airpods|bluetooth|iphone|continuity|virtual|blackhole|loopback|aggregate/i.test(device.label));
}
export async function requestVoiceInput(signal?:AbortSignal):Promise<MediaStream> {
  // Preserve the microphone signal; no speaker playback or aggressive browser noise gate.
  const audio:MediaTrackConstraints={echoCancellation:false,noiseSuppression:false,autoGainControl:{ideal:true},channelCount:{ideal:1}};
  let input:MediaStream|undefined;
  const released=new Set<MediaStream>();
  const stop=()=>{if(input&&!released.has(input)){released.add(input);input.getTracks().forEach(track=>track.stop());}};
  const check=()=>{if(signal?.aborted){stop();const error=new Error('Microphone capture cancelled.');error.name='AbortError';throw error;}};
  const open=async(constraints:MediaStreamConstraints)=>{input=await navigator.mediaDevices.getUserMedia(constraints);check();return input;};
  signal?.addEventListener('abort',stop,{once:true});
  try {
    check();
    const enumerate=async()=>{try{return await navigator.mediaDevices.enumerateDevices?.()||[];}catch{return [];}};
    // With an existing grant, avoid opening a broken default headset at all.
    const knownBuiltin=builtInMicrophone(await enumerate());check();
    if(knownBuiltin){await open({audio:{...audio,deviceId:{exact:knownBuiltin.deviceId}}});return input!;}
    try {await open({audio});}
    catch(error){
      // Never retry permission denial. Retry unsupported default constraints only.
      const name=error&&typeof error==='object'&&'name' in error?error.name:'';
      if(name==='NotReadableError'){
        // A broken default headset may fail just after permission reveals Mac labels.
        const builtin=builtInMicrophone(await enumerate());check();
        if(builtin){await open({audio:{...audio,deviceId:{exact:builtin.deviceId}}});return input!;}
        throw error;
      }
      if(name==='OverconstrainedError')await open({audio:true});
      else throw error;
    }
    check();
    // Labels are normally available only AFTER the user grants microphone access.
    const devices=await enumerate();
    check();
    const builtin=builtInMicrophone(devices);
    const track=input!.getAudioTracks?.()[0];
    if(builtin && track?.getSettings?.().deviceId!==builtin.deviceId && track?.label!==builtin.label){
      stop(); // Release a Bluetooth/headset input before opening the built-in input.
      await open({audio:{...audio,deviceId:{exact:builtin.deviceId}}});
    }
    return input!;
  } catch(error){stop();throw error;}
  finally{signal?.removeEventListener('abort',stop);}
}
export function microphoneError(error:unknown):string {
  const name=error&&typeof error==='object'&&'name' in error?error.name:'';
  if(name==='NotAllowedError'||name==='SecurityError')return 'Microphone access is blocked. Allow your browser in Mac System Settings → Privacy & Security → Microphone, and allow this website to use it.';
  if(name==='NotFoundError'||name==='OverconstrainedError')return 'The Mac microphone is unavailable. Check System Settings → Sound → Input, then try again.';
  if(name==='NotReadableError'||name==='AbortError')return 'The microphone could not start. Check its mute switch and Mac input volume, then try again.';
  return 'Unable to start the microphone. Check browser microphone permission, then try again.';
}
