const audioContext = typeof window !== "undefined" ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume: number = 0.3) {
  if (!audioContext) return;
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

export function playSpinStart() {
  if (!audioContext) return;
  playTone(400, 0.1, "square", 0.2);
  setTimeout(() => playTone(500, 0.1, "square", 0.2), 100);
  setTimeout(() => playTone(600, 0.1, "square", 0.2), 200);
}

export function playSpinTick() {
  if (!audioContext) return;
  playTone(800, 0.05, "square", 0.1);
}

export function playWinSound() {
  if (!audioContext) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.2, "sine", 0.3), i * 100);
  });
  setTimeout(() => {
    notes.reverse().forEach((freq, i) => {
      setTimeout(() => playTone(freq, 0.15, "sine", 0.25), i * 80);
    });
  }, 500);
}

export function playLoseSound() {
  if (!audioContext) return;
  playTone(300, 0.3, "sawtooth", 0.15);
  setTimeout(() => playTone(250, 0.4, "sawtooth", 0.1), 200);
}

export function resumeAudioContext() {
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
}
