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
}

export interface Pollutants {
  [key: string]: number;
}

export interface AQIData {
  aqi: number;
  main_pollutant: string;
  timestamp_unix: number;
  history: AQIHistory[];
  concentrations_us_units: Pollutants;
  zone_id: string;
  zone_name: string;
  source: string;
}

export interface AQIColorResult {
  bg: string;
  hex: string;
}
