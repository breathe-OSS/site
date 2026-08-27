import { STORAGE_KEY_MOTION } from './config.js';

export interface MotionSettings {
  animationsEnabled: boolean;
  screenTransitions: boolean;
  colorTransitions: boolean;
  numberAnimations: boolean;
  pulseEffects: boolean;
  shapeTransitions: boolean;
  pressFeedback: boolean;
  listAnimations: boolean;
}

export type MotionKey = Exclude<keyof MotionSettings, 'animationsEnabled'>;

export const MOTION_KEYS: MotionKey[] = [
  'screenTransitions',
  'colorTransitions',
  'numberAnimations',
  'pulseEffects',
  'shapeTransitions',
  'pressFeedback',
  'listAnimations',
];

export const MOTION_LABELS: { [K in MotionKey]: string } = {
  screenTransitions: 'Screen transitions',
  colorTransitions: 'Colour transitions',
  numberAnimations: 'Number animations',
  pulseEffects: 'Pulse effects',
  shapeTransitions: 'Shape transitions',
  pressFeedback: 'Press feedback',
  listAnimations: 'List animations',
};

export const MOTION_FULL: MotionSettings = {
  animationsEnabled: true,
  screenTransitions: true,
  colorTransitions: true,
  numberAnimations: true,
  pulseEffects: true,
  shapeTransitions: true,
  pressFeedback: true,
  listAnimations: true,
};

export const MOTION_REDUCED: MotionSettings = {
  animationsEnabled: true,
  screenTransitions: true,
  colorTransitions: false,
  numberAnimations: false,
  pulseEffects: false,
  shapeTransitions: false,
  pressFeedback: true,
  listAnimations: false,
};

export const MOTION_DISABLED: MotionSettings = {
  animationsEnabled: false,
  screenTransitions: false,
  colorTransitions: false,
  numberAnimations: false,
  pulseEffects: false,
  shapeTransitions: false,
  pressFeedback: false,
  listAnimations: false,
};

let current: MotionSettings = { ...MOTION_FULL };
let chosen = false;

export function prefersReducedMotion(): boolean {
  if (!window.matchMedia) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function getMotionSettings(): MotionSettings {
  return { ...current };
}

export function motionEnabled(key: MotionKey): boolean {
  if (!current.animationsEnabled) {
    return false;
  }
  return current[key];
}

function applyMotionSettings(): void {
  const off: string[] = [];
  for (const key of MOTION_KEYS) {
    if (!current.animationsEnabled || !current[key]) {
      off.push(key);
    }
  }

  const root = document.documentElement;
  if (off.length === 0) {
    root.removeAttribute('data-motion-off');
  } else {
    root.setAttribute('data-motion-off', off.join(' '));
  }

  if (chosen) {
    root.setAttribute('data-motion-chosen', 'true');
  } else {
    root.removeAttribute('data-motion-chosen');
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY_MOTION, JSON.stringify(current));
  } catch (e) {
    return;
  }
}

export function setMotionSettings(next: MotionSettings): void {
  current = { ...next };
  chosen = true;
  applyMotionSettings();
  persist();
  renderMotionControls();
}

export function setMotionKey(key: MotionKey, value: boolean): void {
  const next = { ...current };
  next[key] = value;
  setMotionSettings(next);
}

export function initMotion(): void {
  let stored: Partial<MotionSettings> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MOTION);
    if (raw) {
      stored = JSON.parse(raw) as Partial<MotionSettings>;
    }
  } catch (e) {
    stored = null;
  }

  if (stored) {
    chosen = true;
    current = { ...MOTION_FULL, ...stored };
  } else if (prefersReducedMotion()) {
    chosen = false;
    current = { ...MOTION_REDUCED };
  } else {
    chosen = false;
    current = { ...MOTION_FULL };
  }

  applyMotionSettings();
  buildMotionControls();

  // Every pulsing element started its own cycle when it mounted, so a list of
  // them drifted into as many phases. One shared epoch, applied as a negative
  // delay, starts them all mid-cycle on the same beat.
  const epoch = (performance.now() % 2000) / 1000;
  document.documentElement.style.setProperty('--pulse-epoch', `${epoch}s`);
}

function presetMatches(preset: MotionSettings): boolean {
  if (current.animationsEnabled !== preset.animationsEnabled) {
    return false;
  }
  for (const key of MOTION_KEYS) {
    if (current[key] !== preset[key]) {
      return false;
    }
  }
  return true;
}

function renderMotionControls(): void {
  const master = document.getElementById('motion-master') as HTMLInputElement | null;
  if (master) {
    master.checked = current.animationsEnabled;
  }

  for (const key of MOTION_KEYS) {
    const input = document.getElementById(`motion-${key}`) as HTMLInputElement | null;
    if (input) {
      input.checked = current[key];
      input.disabled = !current.animationsEnabled;
    }
  }

  const advanced = document.getElementById('motion-advanced');
  if (advanced) {
    advanced.classList.toggle('disabled', !current.animationsEnabled);
  }

  const details = document.getElementById('motion-details');
  if (details) {
    details.classList.toggle('disabled', !current.animationsEnabled);
  }

  const presets: { id: string; value: MotionSettings }[] = [
    { id: 'motion-preset-full', value: MOTION_FULL },
    { id: 'motion-preset-reduced', value: MOTION_REDUCED },
    { id: 'motion-preset-off', value: MOTION_DISABLED },
  ];
  for (const preset of presets) {
    const btn = document.getElementById(preset.id);
    if (btn) {
      btn.classList.toggle('active', presetMatches(preset.value));
    }
  }
}

function buildMotionControls(): void {
  const container = document.getElementById('motion-advanced');
  if (container && container.childElementCount === 0) {
    for (const key of MOTION_KEYS) {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = `
        <div>
          <div class="settings-title">${MOTION_LABELS[key]}</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="motion-${key}" />
          <span class="slider round"></span>
        </label>
      `;
      container.appendChild(row);

      const input = row.querySelector('input') as HTMLInputElement;
      input.addEventListener('change', () => setMotionKey(key, input.checked));
    }
  }

  const master = document.getElementById('motion-master') as HTMLInputElement | null;
  if (master) {
    master.addEventListener('change', () => {
      const next = { ...current };
      next.animationsEnabled = master.checked;
      setMotionSettings(next);
    });
  }

  const presets: { id: string; value: MotionSettings }[] = [
    { id: 'motion-preset-full', value: MOTION_FULL },
    { id: 'motion-preset-reduced', value: MOTION_REDUCED },
    { id: 'motion-preset-off', value: MOTION_DISABLED },
  ];
  for (const preset of presets) {
    const btn = document.getElementById(preset.id);
    if (btn) {
      btn.addEventListener('click', () => setMotionSettings(preset.value));
    }
  }

  renderMotionControls();
}
