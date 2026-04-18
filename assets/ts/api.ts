import { API_URL } from './config.js';
import { Zone, AQIData } from './types.js';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

function getCachedData<T>(key: string): T | null {
  try {
    const cached = sessionStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();

    if (now - entry.timestamp > CACHE_DURATION) {
      sessionStorage.removeItem(key);
      return null;
    }

    return entry.data;
  } catch (e) {
    return null;
  }
}

function setCachedData<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    console.warn('Failed to cache data', e);
  }
}

export async function fetchZones(): Promise<Zone[]> {
  const cacheKey = 'breathe_zones';
  const cached = getCachedData<Zone[]>(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(`${API_URL}/zones`);
    const data = await res.json();
    const zones = data.zones;
    setCachedData(cacheKey, zones);
    return zones;
  } catch (e) {
    console.error('Fetch failed', e);
    return [];
  }
}

export async function getZoneAQI(zoneId: string): Promise<AQIData | null> {
  const cacheKey = `breathe_aqi_${zoneId}`;
  const cached = getCachedData<AQIData>(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(`${API_URL}/aqi/${zoneId}`);
    const aqiData = await res.json();
    setCachedData(cacheKey, aqiData);
    return aqiData;
  } catch (e) {
    return null;
  }
}

export async function getSensorInfoList(): Promise<any[] | null> {
  const cacheKey = `breathe_sensor_info`;
  const cached = getCachedData<any[]>(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(`${API_URL}/sensor-info`);
    if (!res.ok) return null;
    const data = await res.json();
    setCachedData(cacheKey, data.sensors || []);
    return data.sensors || [];
  } catch (e) {
    return null;
  }
}
