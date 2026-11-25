export interface CallAudioPlayResult {
  chimePlayed: boolean;
  voiceAttempted: boolean;
  voiceSupported: boolean;
}

let sharedAudioContext: AudioContext | null = null;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

export async function unlockCallAudioContext(): Promise<boolean> {
  try {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return false;
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctor();
    }
    if (sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume();
    }
    return sharedAudioContext.state === 'running';
  } catch {
    return false;
  }
}

export async function playClinicCallChime(volume: number = 0.7): Promise<boolean> {
  const clampedVol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.7));
  if (clampedVol <= 0.01) return false;

  try {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return false;
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctor();
    }
    if (sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume();
    }

    const ctx = sharedAudioContext;
    const now = ctx.currentTime;

    // Gentle 2-tone ascending hospital/clinic chime (G5 -> B5 -> D6 soft resonance)
    const notes: Array<{ freq: number; offset: number; duration: number; gainScale: number }> = [
      { freq: 523.25, offset: 0, duration: 0.28, gainScale: 0.22 }, // C5
      { freq: 659.25, offset: 0.16, duration: 0.42, gainScale: 0.24 }, // E5
      { freq: 783.99, offset: 0.34, duration: 0.55, gainScale: 0.18 }, // G5
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.offset);

      const peak = clampedVol * note.gainScale;
      gain.gain.setValueAtTime(0.0001, now + note.offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + note.offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.offset + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.offset);
      osc.stop(now + note.offset + note.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function announcePatientCallSpeech(params: {
  text: string;
  enabled: boolean;
  volume?: number;
}): { attempted: boolean; supported: boolean } {
  const supported = isSpeechSynthesisSupported();
  if (!params.enabled || !supported || !params.text.trim()) {
    return { attempted: false, supported };
  }

  try {
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(params.text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.96;
    utterance.pitch = 1.0;
    utterance.volume = Math.max(0, Math.min(1, params.volume ?? 0.9));

    const voices = synth.getVoices ? synth.getVoices() : [];
    const ptVoice =
      voices.find((v) => v.lang.toLowerCase() === 'pt-br') ||
      voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (ptVoice) {
      utterance.voice = ptVoice;
    }

    synth.speak(utterance);
    return { attempted: true, supported: true };
  } catch {
    return { attempted: false, supported };
  }
}

export async function triggerPatientCallAlert(params: {
  soundEnabled: boolean;
  voiceEnabled: boolean;
  chimeVolume: number;
  speechText: string;
}): Promise<CallAudioPlayResult> {
  const voiceSupported = isSpeechSynthesisSupported();
  const chimePlayed = params.soundEnabled
    ? await playClinicCallChime(params.chimeVolume)
    : false;

  if (!params.voiceEnabled || !voiceSupported) {
    return {
      chimePlayed,
      voiceAttempted: false,
      voiceSupported,
    };
  }

  if (chimePlayed) {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 550);
    });
  }

  const speechRes = announcePatientCallSpeech({
    text: params.speechText,
    enabled: params.voiceEnabled,
    volume: Math.max(0.25, Math.min(1, params.chimeVolume || 0.85)),
  });

  return {
    chimePlayed,
    voiceAttempted: speechRes.attempted,
    voiceSupported: speechRes.supported,
  };
}
