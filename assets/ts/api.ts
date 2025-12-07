import { API_URL } from './config.js';
import { Zone, AQIData } from './types.js';

export async function fetchZones(): Promise<Zone[]> {
  try {
    const res = await fetch(`${API_URL}/zones`);
    const data = await res.json();
    return data.zones;
  } catch (e) {
    console.error('Fetch failed', e);
    return [];
  }
}

export async function getZoneAQI(zoneId: string): Promise<AQIData | null> {
  try {
    const res = await fetch(`${API_URL}/aqi/${zoneId}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}
