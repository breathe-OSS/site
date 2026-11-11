export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  provider?: string;
  zone_type?: string;
}

export interface AQIHistory {
  ts: number;
  aqi: number;
  us_aqi?: number;
  pm2_5?: number | null;
  pm10?: number | null;
}

export interface Pollutants {
  [key: string]: number;
}

// every reading comes back null while the sensor is offline
export interface NodeData {
  pm2_5: number | null;
  pm10: number | null;
  temp: number | null;
  humidity: number | null;
  aqi: number | null;
  us_aqi: number | null;
  history?: AQIHistory[];
}

// zone is the zone name, not its id, and name matches the key in AQIData.nodes
export interface SensorInfo {
  name: string;
  zone: string;
  location_id: number;
  provider: string;
  model: string;
  is_kit: boolean;
  latitude?: number;
  longitude?: number;
  installation_date: string;
}

export interface WeatherInfo {
  condition: string;
  weather_code?: number;
  precipitation?: number;
  season: string;
  text: string;
}

export interface AQIData {
  aqi: number;
  us_aqi?: number;
  main_pollutant: string;
  timestamp_unix: number;
  history: AQIHistory[];
  averages_24h?: Pollutants;
  concentrations_us_units: Pollutants;
  zone_id: string;
  zone_name: string;
  source: string;
  warning?: string;
  nodes?: { [name: string]: NodeData };
  weather?: WeatherInfo;
}

export interface WeatherHistoryPoint {
  ts: number;
  condition: string;
  precipitation: number;
}

export interface WeatherHistory {
  interval: number;
  anchor?: number;
  points: WeatherHistoryPoint[];
  zone_id?: string;
}

export interface AQIColorResult {
  bg: string;
  hex: string;
}
