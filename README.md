# SG Bus Timing

Real-time Singapore bus arrival times, built for the [Even Realities G1 smart glasses](https://evenrealities.com) with a companion browser UI.

Scroll and click through nearby bus stops and arrival times directly on your glasses display.

---

## Features

- Detects your location and shows bus stops within 500m
- Real-time arrival times from LTA DataMall, auto-refreshing every 30 seconds
- Fully navigable on glasses (scroll up/down, click)
- Favorites — save stops for quick access
- Works in the browser too (click-based UI)

---

## Prerequisites

- [Node.js](https://nodejs.org) v18+
- An **LTA DataMall API key** — register at [datamall.lta.gov.sg](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html)
- (Optional) [Even Hub SDK + simulator](https://evenrealities.com/developers) for glasses development

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/timfoo/sg-bus-timing.git
cd sg-bus-timing
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your LTA API key:

```
LTA_API_KEY=your_api_key_here
```

> The `.env` file must exist **before** starting the dev server — Vite reads it at startup.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. Grant location access when prompted.

---

## Glasses Setup (Even Realities G1)

### Simulator

1. Install the Even Hub desktop app and simulator
2. In one terminal, start the dev server:
   ```bash
   npm run dev
   ```
3. In another terminal, generate a QR code to connect the simulator:
   ```bash
   npm run qr
   ```
4. Scan the QR code in the Even Hub simulator

### Real glasses

Same as above — scan the QR code with your G1 glasses via the Even Hub app.

---

## Glasses Navigation

| Action | Result |
|--------|--------|
| Scroll down | Move to next item |
| Scroll up | Move to previous item |
| Click | Select highlighted item |

### Screens

**Nearby Stops**
- First item: `★ FAVORITES` — opens your saved stops
- Remaining items: bus stops sorted by distance

**Arrivals**
- First item: `← Back` — returns to stop list
- Second item: `☆ Save` / `★ Saved` — toggle this stop as a favorite
- Remaining rows: services with next 3 arrival times

**Favorites**
- First item: `← BACK` — returns to nearby stops
- Remaining items: your saved stops

---

## Deployment (Vercel)

The API routes in `api/` are Vercel serverless functions that proxy LTA DataMall requests (keeping your API key server-side).

```bash
npm install -g vercel
vercel
```

Set `LTA_API_KEY` as an environment variable in your Vercel project settings.

---

## Project Structure

```
sg-bus-timing/
├── Main.ts          # Frontend app (glasses + browser UI)
├── index.html       # HTML entry point and styles
├── vite.config.ts   # Dev server with LTA API proxy
├── api/
│   ├── bus-arrival.ts   # Serverless: /api/bus-arrival?BusStopCode=
│   └── bus-stops.ts     # Serverless: /api/bus-stops?$skip=
└── .env.example     # Environment variable template
```

---

## Tech Stack

- [Vite](https://vitejs.dev) — dev server and bundler
- [Even Realities SDK](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) — glasses bridge
- [LTA DataMall API](https://datamall.lta.gov.sg) — real-time bus data
- [Vercel](https://vercel.com) — deployment and serverless functions
