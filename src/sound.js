// Sound effects, synthesised with ZzFX (src/zzfx.js). No audio files.
//
// Each effect is a ZZFXSound, built once here at startup and played directly.
// To tweak one, design it at https://killedbyapixel.github.io/ZzFX/ and paste
// the array in. From the console: reversi.sounds.disc = new reversi.ZZFXSound([...])
import { ZZFX, ZZFXSound } from './zzfx.js';

export const SOUNDS = {
  // A disc placed on the board: short click.
  disc:    new ZZFXSound([,.2,,,,.03,4,1.4,,,,,,,,,,,,,3e3]),
  // One disc turning over; played once per flipped disc, staggered like a ripple.
  flip:    new ZZFXSound([.7,.3,2800,,.01,.01,4,1.5,,,,,,,,,,.6,,,5e3]),
  // Someone passed: soft low tone.
  pass:    new ZZFXSound([,,440,,.05,,,,,,440,.05,,,,,.1]),
  // Illegal move: short dull buzz.
  illegal: new ZZFXSound([.8,.3,340,.01,,.02,,.8,-10,,,,,1,,,,.5,.02]),
  // Take back: quick falling blip.
  undo:    new ZZFXSound([.5,,660,,,,1,,20]),
  // A corner taken: a bright ping.
  corner:  new ZZFXSound([.5,,29,.03,,.08,,,27,73,,,,,1.5]),
  // Game over, you won: rising chime.
  win:     new ZZFXSound([,,,.01,,.9,,2,,-40,40,,.1]),
  // Game over, you lost (or a draw): gentle falling tone.
  lose:    new ZZFXSound([,,520,.01,,.9,,2,,40,-40,,.1]),
};

// Delay between flips when several discs turn at once, and the most heard.
const FLIP_STAGGER_MS = 40;
const FLIP_MAX = 8;
// The opponent's discs play slightly lower so you can hear whose move it was.
const OPPONENT_PITCH = 0.85;

let enabled = true;
export function setSoundEnabled(on) { enabled = !!on; }

// Browsers only let audio start after a user gesture. If the AI moves first,
// the context is still suspended: skip that sound rather than queue it.
function ready() {
  if (!enabled) return false;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  const ctx = ZZFX.audioContext;
  if (!ctx) return false; // no audio in this browser: the game plays silently
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// Play a named effect from SOUNDS, optionally pitch-shifted (1 = as designed).
export function playSound(name, pitch = 1) {
  const sound = SOUNDS[name];
  if (!sound || !ready()) return;
  try { sound.play(1, pitch); } catch { /* audio unavailable */ }
}

// A disc goes down; the flipped discs tick over after it, rising in pitch.
export function discSound(flips = 0, opponent = false, corner = false) {
  const pitch = opponent ? OPPONENT_PITCH : 1;
  playSound(corner ? 'corner' : 'disc', pitch);
  for (let i = 0; i < Math.min(flips, FLIP_MAX); i++) {
    setTimeout(() => playSound('flip', pitch * (1 + i * 0.06)), 110 + i * FLIP_STAGGER_MS);
  }
}

export { ZZFXSound };
