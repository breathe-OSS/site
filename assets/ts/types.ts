export type PlaceKind = 'sensor' | 'estimate' | 'district';

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  provider?: string;
  zone_type?: string;
  kind?: PlaceKind;
  district?: string;
  division?: string;
  legacy_zone?: string;
  sensors?: number;
}

export interface AQIHistory {
  ts: number;
  aqi: number;
  us_aqi?: number;
  pm2_5?: number | null;
  pm10?: number | null;
  temp?: number | null;
  humidity?: number | null;
  aqi_raw?: number | null;
  us_aqi_raw?: number | null;
  pm2_5_raw?: number | null;
  pm10_raw?: number | null;
  temp_raw?: number | null;
  humidity_raw?: number | null;
}

export interface SensorReadings {
  pm2_5: number | null;
  pm10: number | null;
  temp: number | null;
  humidity: number | null;
}

export interface RawReadings extends SensorReadings {
  aqi: number | null;
  us_aqi: number | null;
  main_pollutant?: string;
  us_main_pollutant?: string;
  concentrations_us_units?: Pollutants;
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
  kind?: PlaceKind;
  district?: string;
  division?: string;
  location_id?: number;
  sensor_status?: string;
  coordinates?: { lat: number; lon: number };
  readings?: SensorReadings;
  raw?: RawReadings | null;
  raw_available?: boolean;
  averages_24h_raw?: Pollutants;
  us_main_pollutant?: string;
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

export interface ForecastPoint {
  horizon_minutes: number;
  ts: number;
  pm2_5: number;
  pm10: number;
  us_aqi: number;
  aqi: number;
  uses_day_before: boolean;
}

export interface ForecastRecentHour {
  ts: number;
  pm2_5: number;
  pm10: number;
  us_aqi: number;
}

export interface Forecast {
  zone_id: string;
  zone_name: string;
  model: string;
  experimental: boolean;
  issued_at: number;
  current: { pm2_5: number; pm10: number; us_aqi?: number };
  recent?: ForecastRecentHour[];
  points: ForecastPoint[];
}

export interface ForecastRate {
  forecasts: number;
  right: number;
  right_rate: number | null;
  persistence_right_rate: number | null;
}

export interface ForecastHorizonRecord extends ForecastRate {
  horizon_minutes: number;
  mean_miss_pm2_5: number | null;
}

export interface ForecastDayRecord {
  date: string;
  forecasts: number;
  right: number;
  right_rate: number | null;
}

export interface ForecastSeriesPoint {
  ts: number;
  forecast_pm2_5: number;
  actual_pm2_5: number;
  forecast_us_aqi: number;
  actual_us_aqi: number;
  right: boolean;
}

export interface ForecastTrackRecord {
  zone_id: string;
  zone_name: string;
  model: string;
  days: number;
  rule: string;
  from: number;
  to: number;
  overall: ForecastRate;
  horizons: ForecastHorizonRecord[];
  daily: ForecastDayRecord[];
  series: { [horizon: string]: ForecastSeriesPoint[] };
}
