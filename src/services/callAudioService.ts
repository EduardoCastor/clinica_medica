export interface CallAudioPlayResult {
  chimePlayed: boolean;
  voiceAttempted: boolean;
  voiceSupported: boolean;
  voiceName?: string;
  voiceLang?: string;
  audioState: AudioContextState | 'unsupported';
  error?: string;
}

export interface CallAudioUnlockResult {
  unlocked: boolean;
  chimePlayed: boolean;
  audioState: AudioContextState | 'unsupported';
  voiceSupported: boolean;
  voiceCount: number;
  selectedVoiceName?: string;
  selectedVoiceLang?: string;
  reason?: string;
}

let sharedAudioContext: AudioContext | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let voiceListenerRegistered = false;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

export function getCallAudioContextState(): AudioContextState | 'unsupported' {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return 'unsupported';
  return sharedAudioContext ? sharedAudioContext.state : 'suspended';
}

export function isCallAudioRunning(): boolean {
  return Boolean(sharedAudioContext && sharedAudioContext.state === 'running');
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function refreshCachedVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    if (voices.length > 0) {
      cachedVoices = voices;
    }
    return cachedVoices;
  } catch {
    return [];
  }
}

export function ensureSpeechVoicesListener(): void {
  if (!isSpeechSynthesisSupported() || voiceListenerRegistered) return;
  voiceListenerRegistered = true;
  refreshCachedVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      refreshCachedVoices();
    });
  } catch {
    // Fallback for browsers using onvoiceschanged property
    window.speechSynthesis.onvoiceschanged = () => {
      refreshCachedVoices();
    };
  }
}

export async function waitForSpeechVoices(timeoutMs: number = 450): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisSupported()) return [];
  ensureSpeechVoicesListener();

  const existing = refreshCachedVoices();
  if (existing.length > 0) return existing;

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const synth = window.speechSynthesis;

    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      window.clearTimeout(timerId);
      resolve(refreshCachedVoices());
    };

    const onVoicesChanged = () => {
      const list = refreshCachedVoices();
      if (list.length > 0) {
        finish();
      }
    };

    synth.addEventListener('voiceschanged', onVoicesChanged);
    const timerId = window.setTimeout(finish, timeoutMs);
  });
}

export function selectPortugueseSpeechVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const ptBrVoices = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === 'pt-br');
  if (ptBrVoices.length > 0) {
    const preferred =
      ptBrVoices.find((v) => /google|microsoft|natural|luciana|maria|daniel/i.test(v.name)) ||
      ptBrVoices[0];
    return preferred;
  }

  const anyPtVoice = voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
  return anyPtVoice || null;
}

/**
 * Must be invoked directly inside a user interaction (click/tap) so browsers grant audio permission.
 * Creates/resumes AudioContext synchronously before awaiting, warms up speech voices, and plays a subtle test chime.
 */
export async function unlockAndTestCallAudio(
  volume: number = 0.7
): Promise<CallAudioUnlockResult> {
  const voiceSupported = isSpeechSynthesisSupported();
  ensureSpeechVoicesListener();

  const Ctor = getAudioContextConstructor();
  if (!Ctor) {
    return {
      unlocked: false,
      chimePlayed: false,
      audioState: 'unsupported',
      voiceSupported,
      voiceCount: 0,
      reason: 'Este navegador não oferece suporte à Web Audio API.',
    };
  }

  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctor();
    }
    const resumePromise =
      sharedAudioContext.state === 'suspended'
        ? sharedAudioContext.resume()
        : Promise.resolve();

    await Promise.race([
      resumePromise,
      new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ]);

    if (sharedAudioContext.state !== 'running') {
      return {
        unlocked: false,
        chimePlayed: false,
        audioState: sharedAudioContext.state,
        voiceSupported,
        voiceCount: cachedVoices.length,
        reason: 'O navegador manteve o áudio suspenso. Clique novamente em ATIVAR SOM ou verifique as permissões de áudio da guia.',
      };
    }

    const chimePlayed = await playClinicCallChime(Math.min(0.6, Math.max(0.25, volume)));

    // Warm up speechSynthesis voices (also inside user gesture)
    const voices = await waitForSpeechVoices(400);
    const chosenVoice = selectPortugueseSpeechVoice(voices);

    if (voiceSupported && typeof window !== 'undefined') {
      try {
        // Gentle empty warm-up only if not currently speaking
        if (!window.speechSynthesis.speaking) {
          const warmup = new SpeechSynthesisUtterance('');
          warmup.volume = 0;
          warmup.lang = 'pt-BR';
          window.speechSynthesis.speak(warmup);
        }
      } catch {
        // Ignore speech warm-up errors; chime still works
      }
    }

    return {
      unlocked: sharedAudioContext.state === 'running',
      chimePlayed,
      audioState: sharedAudioContext.state,
      voiceSupported,
      voiceCount: voices.length,
      selectedVoiceName: chosenVoice?.name,
      selectedVoiceLang: chosenVoice?.lang,
    };
  } catch (err) {
    return {
      unlocked: false,
      chimePlayed: false,
      audioState: sharedAudioContext ? sharedAudioContext.state : 'suspended',
      voiceSupported,
      voiceCount: cachedVoices.length,
      reason:
        err instanceof Error
          ? err.message
          : 'Falha ao inicializar os recursos de áudio no navegador.',
    };
  }
}

export async function unlockCallAudioContext(): Promise<boolean> {
  try {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return false;
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctor();
    }
    if (sharedAudioContext.state === 'suspended') {
      await Promise.race([
        sharedAudioContext.resume(),
        new Promise<void>((resolve) => setTimeout(resolve, 450)),
      ]);
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
      await Promise.race([
        sharedAudioContext.resume(),
        new Promise<void>((resolve) => setTimeout(resolve, 450)),
      ]);
    }

    // Never report chimePlayed=true if browser kept AudioContext suspended (autoplay blocked)
    if (sharedAudioContext.state !== 'running') {
      return false;
    }

    const ctx = sharedAudioContext;
    const now = ctx.currentTime;

    // Gentle 3-tone ascending clinical chime (short, soft, non-aggressive)
    const notes: Array<{ freq: number; offset: number; duration: number; gainScale: number }> = [
      { freq: 523.25, offset: 0, duration: 0.24, gainScale: 0.22 }, // C5
      { freq: 659.25, offset: 0.14, duration: 0.34, gainScale: 0.24 }, // E5
      { freq: 783.99, offset: 0.3, duration: 0.48, gainScale: 0.18 }, // G5
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

export async function announcePatientCallSpeech(params: {
  text: string;
  enabled: boolean;
  volume?: number;
}): Promise<{
  attempted: boolean;
  spoken: boolean;
  supported: boolean;
  voiceName?: string;
  voiceLang?: string;
  error?: string;
}> {
  const supported = isSpeechSynthesisSupported();
  if (!params.enabled || !supported || !params.text.trim()) {
    return { attempted: false, spoken: false, supported };
  }

  try {
    const synth = window.speechSynthesis;
    const voices = await waitForSpeechVoices(400);
    const chosenVoice = selectPortugueseSpeechVoice(voices);

    // Avoid Chromium bug where synth.cancel() immediately before speak() cancels the new utterance
    if (synth.speaking || synth.pending) {
      synth.cancel();
      await new Promise<void>((resolve) => setTimeout(resolve, 65));
    }

    return await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(params.text);
      utterance.lang = chosenVoice?.lang || 'pt-BR';
      utterance.rate = 0.96;
      utterance.pitch = 1.0;
      utterance.volume = Math.max(0, Math.min(1, params.volume ?? 0.9));
      if (chosenVoice) {
        utterance.voice = chosenVoice;
      }

      let resolved = false;
      const done = (result: { spoken: boolean; error?: string }) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(guardTimer);
        resolve({
          attempted: true,
          spoken: result.spoken,
          supported: true,
          voiceName: chosenVoice?.name,
          voiceLang: chosenVoice?.lang || 'pt-BR',
          error: result.error,
        });
      };

      utterance.onstart = () => {
        done({ spoken: true });
      };

      utterance.onend = () => {
        done({ spoken: true });
      };

      utterance.onerror = (ev) => {
        done({
          spoken: false,
          error: ev?.error ? `speechSynthesis: ${ev.error}` : 'Erro na síntese de voz.',
        });
      };

      // Safety fallback if browser queues speech without firing onstart promptly
      const guardTimer = window.setTimeout(() => {
        done({ spoken: synth.speaking || synth.pending });
      }, 1500);

      synth.speak(utterance);
    });
  } catch (err) {
    return {
      attempted: false,
      spoken: false,
      supported,
      error: err instanceof Error ? err.message : 'Falha na síntese de voz.',
    };
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
  const audioState = getCallAudioContextState();

  if (!params.voiceEnabled || !voiceSupported) {
    return {
      chimePlayed,
      voiceAttempted: false,
      voiceSupported,
      audioState,
      error:
        params.soundEnabled && !chimePlayed && audioState !== 'running'
          ? 'Áudio aguardando ativação pelo usuário nesta aba.'
          : undefined,
    };
  }

  if (chimePlayed) {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 650);
    });
  }

  const speechRes = await announcePatientCallSpeech({
    text: params.speechText,
    enabled: params.voiceEnabled,
    volume: Math.max(0.25, Math.min(1, params.chimeVolume || 0.85)),
  });

  return {
    chimePlayed,
    voiceAttempted: speechRes.attempted,
    voiceSupported: speechRes.supported,
    voiceName: speechRes.voiceName,
    voiceLang: speechRes.voiceLang,
    audioState,
    error:
      speechRes.error ||
      (params.soundEnabled && !chimePlayed && audioState !== 'running'
        ? 'Áudio aguardando ativação pelo usuário nesta aba.'
        : undefined),
  };
}
