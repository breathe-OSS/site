import { AQIColorResult } from './types.js';
import { STORAGE_KEY_THEME } from './config.js';

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

// aqi colors (according to naqi)
export function getAQIColor(aqi: number): AQIColorResult {
  const style = getComputedStyle(document.documentElement);

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
