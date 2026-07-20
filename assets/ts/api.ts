import { API_URL } from './config.js';
import { Zone, AQIData, RankedCity } from './types.js';

const CACHE_DURATION = 5 * 60 * 1000;

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
  
  if (cached) return cached;

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
  
  if (cached) return cached;

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

  if (cached) return cached;

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

export async function fetchHistoricalData(
  zoneId: string,
  timeRange: string,
  interval: string,
  metrics: string = 'pm2.5,pm10'
): Promise<any> {
  const cacheKey = `breathe_hist_${zoneId}_${timeRange}_${interval}_${metrics}`;
  const cached = getCachedData<any>(cacheKey);

  if (cached) return cached;

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

export async function fetchCityRankings(): Promise<RankedCity[]> {
  const cacheKey = 'breathe_city_rankings';
  
  sessionStorage.removeItem(cacheKey); 

  try {
    const zones = await fetchZones();
    if (!zones || zones.length === 0) return [];

    const promises = zones.map(async (zone) => {
        try {
            const data = await getZoneAQI(zone.id);
            const aqi = data ? (data.aqi ?? 0) : 0; 
            return { rank: 0, name: zone.name, aqi: aqi, trend: 'stable' } as RankedCity;
        } catch (error) {
            return { rank: 0, name: zone.name, aqi: 0, trend: 'stable' } as RankedCity;
        }
    });

    const results = await Promise.all(promises);
    
    results.sort((a, b) => a.aqi - b.aqi);

    const rankings = results.map((item, index) => ({
        ...item,
        rank: index + 1
    }));

    setCachedData(cacheKey, rankings);
    return rankings;
  } catch (e) {
    console.error('Failed to calculate city rankings', e);
    return [];
  }
}