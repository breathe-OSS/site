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
}

export interface Pollutants {
  [key: string]: number;
}

export interface NodeData {
  pm2_5: number;
  pm10: number;
  temp: number;
  humidity: number;
  aqi: number;
  us_aqi: number;
  history?: AQIHistory[];
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
}

export interface AQIColorResult {
  bg: string;
  hex: string;
}
