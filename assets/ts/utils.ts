import { AQIColorResult } from './types.js';
import { STORAGE_KEY_THEME, STORAGE_KEY_STANDARD } from './config.js';

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
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem(STORAGE_KEY_THEME, newTheme);
      onChange(newTheme);
    });
  }
}

export function getCurrentTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function getAQIStandard(): 'india' | 'us' {
  return (localStorage.getItem(STORAGE_KEY_STANDARD) as 'india' | 'us') || 'india';
}

export function initStandard(onChange: (std: string) => void): void {
  const toggle = document.getElementById('aqi-standard-toggle') as HTMLInputElement;
  const saved = getAQIStandard();
  
  if (toggle) {
    toggle.checked = saved === 'us';
    toggle.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const newStd = target.checked ? 'us' : 'india';
      localStorage.setItem(STORAGE_KEY_STANDARD, newStd);
      onChange(newStd);
    });
  }
}

export function calculateCigarettes(pm25: number): number {
  // 22 µg/m³ ≈ 1 cigarette
  const cigs = pm25 / 22.0;
  return Math.round(cigs * 10) / 10;
}

// aqi colors
export function getAQIColor(aqi: number, standard: 'india' | 'us' = 'india'): AQIColorResult {
  const style = getComputedStyle(document.documentElement);

  if (standard === 'us') {
    // US EPA Colors
    if (aqi <= 50) return { bg: 'bg-good', hex: '#00E400' };
    if (aqi <= 100) return { bg: 'bg-moderate', hex: '#FFFF00' };
    if (aqi <= 150) return { bg: 'bg-poor', hex: '#FF7E00' };
    if (aqi <= 200) return { bg: 'bg-very-poor', hex: '#FF0000' };
    if (aqi <= 300) return { bg: 'bg-severe', hex: '#8F3F97' };
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