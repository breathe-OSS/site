import { API_URL } from './config.js';
import { Zone, AQIData, WeatherHistory, SensorInfo } from './types.js';

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

// one /aqi/zones request for whatever isn't cached yet. backends without it
// 404, and then it goes back to asking zone by zone. a zone that fails comes
// back as null, same as getZoneAQI
export async function getZonesAQI(zoneIds: string[]): Promise<{ [id: string]: AQIData | null }> {
  const result: { [id: string]: AQIData | null } = {};
  const missing: string[] = [];

  zoneIds.forEach((id) => {
    const cached = getCachedData<AQIData>(`breathe_aqi_${id}`);
    if (cached) {
      result[id] = cached;
    } else {
      missing.push(id);
    }
  });

  if (missing.length === 0) {
    return result;
  }

  try {
    const res = await fetch(
      `${API_URL}/aqi/zones?ids=${missing.map(encodeURIComponent).join(',')}`
    );
    if (res.ok) {
      const data: { zones: AQIData[] } = await res.json();
      data.zones.forEach((zone) => setCachedData(`breathe_aqi_${zone.zone_id}`, zone));
      const byId: { [id: string]: AQIData } = {};
      data.zones.forEach((zone) => {
        byId[zone.zone_id] = zone;
      });
      missing.forEach((id) => {
        result[id] = byId[id] ?? null;
      });
      return result;
    }
  } catch (e) {
    console.warn('Bulk AQI fetch failed, falling back to per zone', e);
  }

  const fetched = await Promise.all(missing.map((id) => getZoneAQI(id)));
  missing.forEach((id, i) => {
    result[id] = fetched[i];
  });
  return result;
}

export async function getSensorInfoList(): Promise<SensorInfo[] | null> {
  const cacheKey = `breathe_sensor_info`;
  const cached = getCachedData<SensorInfo[]>(cacheKey);

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

export async function fetchWeatherHistory(
  zoneId: string,
  timeRange: string,
  interval: string
): Promise<WeatherHistory | null> {
  const cacheKey = `breathe_weather_${zoneId}_${timeRange}_${interval}`;
  const cached = getCachedData<WeatherHistory>(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(`${API_URL}/weather-history/${zoneId}/${timeRange}/${interval}`);
    if (!res.ok) return null;
    const data = await res.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (e) {
    console.error('Failed to fetch weather history', e);
    return null;
  }
}

export async function fetchHistoricalData(
  zoneId: string,
  timeRange: string,
  interval: string,
  metrics: string = 'pm2.5,pm10'
): Promise<any> {
  const cacheKey = `breathe_hist_${zoneId}_${timeRange}_${interval}_${metrics}`;
  const cached = getCachedData<any>(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(
      `${API_URL}/historical-data/${zoneId}/${timeRange}/${interval}/${metrics}?format=json`
    );
    if (!res.ok) return { data: [], stats: {} };
    const data = await res.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (e) {
    console.error('Failed to fetch historical data', e);
    return { data: [], stats: {} };
  }
}
