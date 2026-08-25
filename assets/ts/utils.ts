import { AQIColorResult } from './types.js';
import { STORAGE_KEY_THEME, STORAGE_KEY_STANDARD } from './config.js';

export function makeActivatable(el: HTMLElement): void {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
}

export function initKeyboardActivation(): void {
  const selector = '.settings-item.clickable, .promo-card.clickable';
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => makeActivatable(el));

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (!target || !target.matches('.clickable, .dashboard-card, .explore-card')) {
      return;
    }
    e.preventDefault();
    target.click();
  });
}

function closeSheet(overlay: HTMLElement): void {
  const name = overlay.dataset.closeFn;
  const closer = name ? (window as any)[name] : null;
  if (typeof closer === 'function') {
    closer();
    return;
  }
  overlay.classList.add('hidden');
}

function attachSheetDrag(sheet: HTMLElement): void {
  const overlay = sheet.closest('.bottom-sheet-overlay') as HTMLElement | null;
  if (!overlay) {
    return;
  }

  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;

  sheet.addEventListener('pointerdown', (e: PointerEvent) => {
    if (window.innerWidth >= 768) {
      return;
    }
    if (sheet.scrollTop > 0) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) {
      return;
    }

    dragging = true;
    startY = e.clientY;
    lastY = e.clientY;
    lastTime = performance.now();
    velocity = 0;
    sheet.classList.add('dragging');
    sheet.setPointerCapture(e.pointerId);
  });

  sheet.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const now = performance.now();
    if (now > lastTime) {
      velocity = (e.clientY - lastY) / (now - lastTime);
    }
    lastY = e.clientY;
    lastTime = now;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    sheet.classList.remove('dragging');

    const travelled = Math.max(0, e.clientY - startY);
    sheet.style.transform = '';

    if (travelled > sheet.offsetHeight * 0.45 || velocity > 0.5) {
      closeSheet(overlay);
    }
  };

  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);
}

export function initSheetDragging(): void {
  document.querySelectorAll<HTMLElement>('.bottom-sheet').forEach(attachSheetDrag);
}

export function motionDuration(token: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (raw.endsWith('ms')) {
    return parseFloat(raw);
  }
  if (raw.endsWith('s')) {
    return parseFloat(raw) * 1000;
  }
  return 0;
}

const countTimers = new WeakMap<HTMLElement, number>();

// Rolls an element's number to a new value. Reads its duration from the motion
// token, so switching numberAnimations off collapses it to a plain assignment
// without this needing to know about the setting.
export function animateCount(el: HTMLElement, to: number): void {
  const previous = countTimers.get(el);
  if (previous) {
    cancelAnimationFrame(previous);
    countTimers.delete(el);
  }

  const duration = motionDuration('--motion-num');
  const from = parseInt(el.innerText, 10);

  if (!duration || duration < 20 || isNaN(from) || from === to) {
    el.innerText = to.toString();
    return;
  }

  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.innerText = Math.round(from + (to - from) * eased).toString();
    if (t < 1) {
      countTimers.set(el, requestAnimationFrame(step));
    } else {
      countTimers.delete(el);
    }
  };
  countTimers.set(el, requestAnimationFrame(step));
}

let themeChangeTimer = 0;

// theme management
export function initTheme(onChange: (theme: string) => void): void {
  const toggle = document.getElementById('theme-toggle') as HTMLInputElement;
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';

  document.documentElement.setAttribute('data-theme', savedTheme);
  if (toggle) {
    toggle.checked = savedTheme === 'dark';
    toggle.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const newTheme = target.checked ? 'dark' : 'light';

      // Only carry the blanket transition for the length of the flip, so
      // ordinary repaints never pay for it.
      const root = document.documentElement;
      root.classList.add('theme-changing');
      window.clearTimeout(themeChangeTimer);
      themeChangeTimer = window.setTimeout(
        () => root.classList.remove('theme-changing'),
        motionDuration('--motion-color') + 50
      );

      root.setAttribute('data-theme', newTheme);
      localStorage.setItem(STORAGE_KEY_THEME, newTheme);
      onChange(newTheme);
    });
  }
}

export function getCurrentTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function getAQIStandard(): 'india' | 'us' {
  const saved = localStorage.getItem(STORAGE_KEY_STANDARD);
  return saved === 'india' ? 'india' : 'us';
}

export function formatPollutantName(pollutant: string): string {
  const upper = pollutant.toUpperCase();
  if (upper === 'PM2_5') return 'PM<sub>2.5</sub>';
  if (upper === 'PM10') return 'PM<sub>10</sub>';
  return upper;
}

let standardChangeHandler: ((std: string) => void) | null = null;
let standardSwapTimer = 0;

// The two scales disagree by design: the same reading is 104 on EPA and 60 on
// CPCB. Dipping every reading together and swapping at the trough makes that
// read as one deliberate rescale rather than the page glitching.
export function setAQIStandard(newStd: 'india' | 'us'): void {
  const epaRadio = document.getElementById('toggle-epa') as HTMLInputElement | null;
  const naqiRadio = document.getElementById('toggle-naqi') as HTMLInputElement | null;
  if (epaRadio) {
    epaRadio.checked = newStd === 'us';
  }
  if (naqiRadio) {
    naqiRadio.checked = newStd === 'india';
  }
  localStorage.setItem(STORAGE_KEY_STANDARD, newStd);

  const apply = () => {
    if (standardChangeHandler) {
      standardChangeHandler(newStd);
    }
  };

  const dip = motionDuration('--motion-press');
  if (dip < 20) {
    apply();
    return;
  }

  const root = document.documentElement;
  root.classList.add('standard-swapping');
  window.clearTimeout(standardSwapTimer);
  standardSwapTimer = window.setTimeout(() => {
    apply();
    root.classList.remove('standard-swapping');
  }, dip);
}

export function initStandard(onChange: (std: string) => void): void {
  standardChangeHandler = onChange;

  const epaRadio = document.getElementById('toggle-epa') as HTMLInputElement | null;
  const naqiRadio = document.getElementById('toggle-naqi') as HTMLInputElement | null;
  const saved = getAQIStandard();

  if (epaRadio && naqiRadio) {
    epaRadio.checked = saved === 'us';
    naqiRadio.checked = saved === 'india';

    epaRadio.addEventListener('change', () => {
      if (epaRadio.checked) {
        setAQIStandard('us');
      }
    });

    naqiRadio.addEventListener('change', () => {
      if (naqiRadio.checked) {
        setAQIStandard('india');
      }
    });
  }
}

export function calculateCigarettes(pm25: number): number {
  // 22 µg/m³ ≈ 1 cigarette
  const cigs = pm25 / 22.0;
  return Math.round(cigs * 10) / 10;
}

// AQI category labels
export function getAQICategory(aqi: number, standard: 'india' | 'us' = 'us'): string {
  if (standard === 'us') {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
  }

  // NAQI categories
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

// Calculate position on AQI bar (0-100%)
export function getAQIBarPosition(aqi: number, standard: 'india' | 'us' = 'us'): number {
  if (standard === 'us') {
    if (aqi <= 50) return (aqi / 50) * 10;
    if (aqi <= 100) return 10 + ((aqi - 50) / 50) * 10;
    if (aqi <= 150) return 20 + ((aqi - 100) / 50) * 10;
    if (aqi <= 200) return 30 + ((aqi - 150) / 50) * 10;
    if (aqi <= 300) return 40 + ((aqi - 200) / 100) * 20;
    return Math.min(60 + ((aqi - 300) / 200) * 40, 100);
  }

  // NAQI scale
  if (aqi <= 50) return (aqi / 50) * 10;
  if (aqi <= 100) return 10 + ((aqi - 50) / 50) * 10;
  if (aqi <= 200) return 20 + ((aqi - 100) / 100) * 15;
  if (aqi <= 300) return 35 + ((aqi - 200) / 100) * 15;
  if (aqi <= 400) return 50 + ((aqi - 300) / 100) * 20;
  return Math.min(70 + ((aqi - 400) / 100) * 30, 100);
}

// aqi colors
export function getAQIColor(aqi: number, standard: 'india' | 'us' = 'us'): AQIColorResult {
  const style = getComputedStyle(document.documentElement);

  if (standard === 'us') {
    // US EPA Colors
    if (aqi <= 50) return { bg: 'bg-good', hex: '#00E400' };
    if (aqi <= 100) return { bg: 'bg-moderate', hex: '#FFFF00' };
    if (aqi <= 150) return { bg: 'bg-poor', hex: '#FF7E00' };
    if (aqi <= 200) return { bg: 'bg-poor', hex: '#FF0000' };
    if (aqi <= 300) return { bg: 'bg-very-poor', hex: '#8F3F97' };
    return { bg: 'bg-severe', hex: '#7E0023' };
  }

  // NAQI Colors
  if (aqi <= 50) return { bg: 'bg-good', hex: style.getPropertyValue('--aqi-good').trim() };
  if (aqi <= 100)
    return {
      bg: 'bg-satisfactory',
      hex: style.getPropertyValue('--aqi-satisfactory').trim(),
    };
  if (aqi <= 200)
    return {
      bg: 'bg-moderate',
      hex: style.getPropertyValue('--aqi-moderate').trim(),
    };
  if (aqi <= 300) return { bg: 'bg-poor', hex: style.getPropertyValue('--aqi-poor').trim() };
  if (aqi <= 400)
    return {
      bg: 'bg-very-poor',
      hex: style.getPropertyValue('--aqi-very-poor').trim(),
    };
  return { bg: 'bg-severe', hex: style.getPropertyValue('--aqi-severe').trim() };
}

function usAqiInterp(c: number, cLow: number, cHigh: number, iLow: number, iHigh: number): number {
  return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow);
}

export function calculateUsAqi(pm25: number): number {
  const c = Math.floor(pm25 * 10) / 10;
  if (c <= 9.0) return usAqiInterp(c, 0, 9.0, 0, 50);
  if (c <= 35.4) return usAqiInterp(c, 9.1, 35.4, 51, 100);
  if (c <= 55.4) return usAqiInterp(c, 35.5, 55.4, 101, 150);
  if (c <= 125.4) return usAqiInterp(c, 55.5, 125.4, 151, 200);
  if (c <= 225.4) return usAqiInterp(c, 125.5, 225.4, 201, 300);
  if (c <= 325.4) return usAqiInterp(c, 225.5, 325.4, 301, 400);
  return usAqiInterp(c, 325.5, 500.4, 401, 500);
}

export function calculateUsAqiPm10(pm10: number): number {
  const c = Math.floor(pm10);
  if (c <= 54) return usAqiInterp(c, 0, 54, 0, 50);
  if (c <= 154) return usAqiInterp(c, 55, 154, 51, 100);
  if (c <= 254) return usAqiInterp(c, 155, 254, 101, 150);
  if (c <= 354) return usAqiInterp(c, 255, 354, 151, 200);
  if (c <= 424) return usAqiInterp(c, 355, 424, 201, 300);
  if (c <= 504) return usAqiInterp(c, 425, 504, 301, 400);
  return usAqiInterp(c, 505, 604, 401, 500);
}
