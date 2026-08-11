# Breathe (Web)

> _"Breathe, breathe in the air. Don't be afraid to care."_ - **Pink Floyd**, _The Dark Side of the Moon_

<p align="center">
  <img src="assets/images/logo.png" alt="App Icon" width="128"/>
</p>

> **Note:** This repository is the **web** version of Breathe, live at [breatheoss.app](https://breatheoss.app). If you are looking for the mobile apps, please visit the [Android](https://github.com/breathe-OSS/breathe) and [iOS](https://github.com/breathe-OSS/breathe-ios) repositories.

**Breathe** is a modern web application designed to monitor real-time Air Quality Index (AQI) levels across J&K & Ladakh. Built with **TypeScript**, it provides a clean, responsive interface to track pollution levels using the Indian National Air Quality Index (NAQI) standards.

- Check the [**breathe api**](https://github.com/breathe-OSS/api?tab=readme-ov-file#how-the-aqi-is-calculated) repo to know how the AQI is calculated.

## Live

[breatheoss.app](https://breatheoss.app)

---

## Features

- **Responsive Material-inspired UI**
- **Light & Dark Theme Support**
- **Real-time Monitoring**
- **US and Indian AQI standards**
- **Detailed Breakdown**
- **Cigarette equivalence**
- **Interactive map with data laid across**
- **24 Hour graph of AQI Data**
- **Swipeable dots & contribution history**
- **Detailed extended graph data for sensor based locations**
- **Live weather context (rain washout, winter smog, clear days)**
- **Filter extended history by weather condition**

## Tech Stack

- **Language:** TypeScript
- **Rendering:** Vanilla DOM (no framework)
- **Charts:** Chart.js
- **Maps:** Leaflet
- **Build:** tsc

## Structure

```site/
├── assets/
│   ├── css/            # Styles
│   ├── images/         # Logos and icons
│   ├── js/             # Compiled output (tsc)
│   └── ts/             # TypeScript source
│       ├── api.ts      # API client
│       ├── config.ts   # Configuration
│       ├── main.ts     # Entry point / controller
│       ├── map.ts      # Map view
│       ├── types.ts    # Data models
│       ├── ui.ts       # UI rendering
│       └── utils.ts    # Helper functions
├── privacy/            # Privacy policy page
└── index.html          # App shell
```

## Build and deploy locally

### Prerequisites

- Node.js and npm.
- A running instance of the **Breathe Backend** (Python/FastAPI).

### Installation

1. **Clone the repository:**
   `git clone https://github.com/breathe-OSS/site && cd site`

2. **Install dependencies:**
   `npm install`

3. **Configure the API Endpoint:**
   - Update `API_URL` in `assets/ts/config.ts` to point to your backend server.

4. **Build and Run:**
   - Compile the TypeScript with `npm run dev` (`tsc --watch`), then serve the folder statically, e.g. `npx serve .`

## AQI Data Providers

### Why this exists

Publicly available AQI data for the J&K & Ladakh region is currently unreliable. Most standardized sources rely on sparse sensor networks or algorithmic modeling that does not accurately reflect ground-level realities. This results in widely varying values across different platforms. **Google**, for example, shows values that are insanely **low**, but they are usually off by a huge margin.

**Breathe** aims to solve this by strictly curating sources and building a ground-truth network.

## Current Data Sources

### Open-Meteo

Used for all pollutant values for **most regions** in J&K & Ladakh.
Open-Meteo's satellite-based air quality model provides stable and consistent values that generally fall within the expected range of nearby ground measurements.

- Air quality & pollutant data: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)

- Weather forecasts & historical data: [Open-Meteo](https://open-meteo.com)

### AirGradient

Used for other regions where we have gotten contributions to, the sensors are deployed in real time.

- Their website: [AirGradient](https://www.airgradient.com/)

This provides accurate values of PM10 and PM2.5. Other values are fetched from Open-Meteo (like O₃ and NO₂)

## Call for Contributors (Hardware)

The limitations of our current project is that we do not have ground sensors in every region and are mostly relying on satellite data, so the data is **not 100%** accurate.

We are actively working to deploy custom physical sensors to improve data density in Jammu. If you are interested in hosting a sensor node, please contact us at: [contact@breatheoss.app](mailto:contact@breatheoss.app)

We have deployed **AirGradient** sensors in Jammu, Srinagar, Leh, Rajouri, Doda, Samba, Udhampur & Bandipora (as of 28/07/26) which provide an accurate measurement of PM10 and PM2.5 values. We are working
to deploy them in all other regions.

## Credits & Developers

This project is fully Free & Open Source Software (FOSS).

1. [sidharthify](https://github.com/sidharthify) (Lead Dev)
2. [Flashwreck](https://github.com/Flashwreck) (Lead dev and devops maintainer)
3. [SleeperOfSaturn](https://github.com/SleeperOfSaturn) (iOS app co-lead)
4. [Lostless1907](https://github.com/Lostless1907) (Contributor and developer)
5. [suveshmoza](https://github.com/suveshmoza) (Contributor and developer)
6. [empirea9](https://github.com/empirea9) (Contributor)
