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
  const saved = localStorage.getItem(STORAGE_KEY_STANDARD);
  return saved === 'india' ? 'india' : 'us';
}

export function formatPollutantName(pollutant: string): string {
  const upper = pollutant.toUpperCase();
  if (upper === 'PM2_5') return 'PM<sub>2.5</sub>';
  if (upper === 'PM10') return 'PM<sub>10</sub>';
  return upper;
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

// AQI category labels
export function getAQICategory(aqi: number, standard: 'india' | 'us' = 'india'): string {
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
export function getAQIBarPosition(aqi: number, standard: 'india' | 'us' = 'india'): number {
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
export function getAQIColor(aqi: number, standard: 'india' | 'us' = 'india'): AQIColorResult {
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
