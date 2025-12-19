let audioContext: AudioContext | null = null;
let soundEnabled = true;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn("Audio context not available");
      return null;
    }
  }
  return audioContext;
}

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume: number = 0.3) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  
  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch (e) {
    console.warn("Failed to play tone:", e);
  }
}

export function playSpinStart() {
  if (!soundEnabled) return;
  playTone(440, 0.08, "triangle", 0.15);
  setTimeout(() => playTone(550, 0.08, "triangle", 0.15), 80);
  setTimeout(() => playTone(660, 0.1, "triangle", 0.2), 160);
}

export function playSpinTick() {
  if (!soundEnabled) return;
  playTone(600 + Math.random() * 200, 0.03, "triangle", 0.08);
}

export function playWinSound() {
  if (!soundEnabled) return;
  const notes = [523, 659, 784, 880, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.25, "sine", 0.25), i * 80);
  });
  setTimeout(() => {
    playTone(1047, 0.5, "sine", 0.3);
    playTone(1319, 0.5, "sine", 0.2);
    playTone(1568, 0.5, "sine", 0.15);
  }, 500);
}

export function playBigWinSound() {
  if (!soundEnabled) return;
  const fanfare = [523, 659, 784, 1047, 1319, 1568];
  fanfare.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.3, "sine", 0.3);
      playTone(freq * 1.5, 0.3, "sine", 0.15);
    }, i * 100);
  });
}

export function playLoseSound() {
  if (!soundEnabled) return;
  playTone(300, 0.2, "sine", 0.1);
  setTimeout(() => playTone(250, 0.3, "sine", 0.08), 150);
}

export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}
