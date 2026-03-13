# SG Bus Timing — Project Notes

## Dev Setup

Start both processes to develop:

```bash
npm run dev                              # Vite dev server on http://localhost:5173
evenhub-simulator http://localhost:5173/ # Even Hub glasses simulator
```

Requires `LTA_API_KEY` in `.env` (see `.env.example`). The dev server must be started AFTER the `.env` file exists — Vite reads env vars at startup time.

## Architecture

- `Main.ts` — frontend: GPS → nearby stops → glasses list → arrivals
- `api/bus-arrival.ts` — Vercel function: proxies LTA BusArrival
- `api/bus-stops.ts` — Vercel function: proxies LTA BusStops (paginated)
- `vite.config.ts` — dev proxies for both API endpoints (adds `AccountKey` header)

UX flow:
1. App loads → gets GPS → fetches all bus stops (paginated, cached in sessionStorage) → filters within 500m
2. Glasses shows list container of nearby stops; Up/Down to navigate, Click to select
3. Arrivals shown as text container; Double-click to go back to stop list
4. Browser mirrors the same flow with clickable cards and a Back button

## Vite Proxy (LTA DataMall API)

The proxy in `vite.config.ts` rewrites local `/api/*` paths → LTA DataMall.

**Critical**: use `rewrite: (path) => path.replace(...)` to preserve the query string. Using `rewrite: () => '/path'` (ignoring the argument) strips query params.

```ts
rewrite: (path) => path.replace('/api/bus-arrival', '/ltaodataservice/v3/BusArrival'),
configure: (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('AccountKey', env.LTA_API_KEY ?? '')
  })
},
```

Same pattern applies to `/api/bus-stops` → `/ltaodataservice/v3/BusStops`.

## LTA DataMall — Bus Stops

- Endpoint: `/ltaodataservice/v3/BusStops?$skip=N`
- Returns up to 500 stops per page; paginate with `$skip` until `value.length < 500`
- ~5000 stops total; cache in `sessionStorage` after first fetch
- Fields: `BusStopCode`, `RoadName`, `Description`, `Latitude`, `Longitude`

## EvenHub SDK + Simulator

### Always use `rebuildPageContainer`, not `createStartUpPageContainer`

`createStartUpPageContainer` returns `-1` (invalid) in the simulator — the simulator auto-initialises the startup page itself. Use `rebuildPageContainer` for every update, including the first one.

```ts
import { RebuildPageContainer, TextContainerProperty } from '@evenrealities/even_hub_sdk'

const result = await bridge.rebuildPageContainer(new RebuildPageContainer({
  containerTotalNum: 1,
  textObject: [new TextContainerProperty({ ... })],
}))
```

### Use SDK class constructors, not plain objects

Pass proper class instances (`new TextContainerProperty({...})`, `new RebuildPageContainer({...})`) so `toJson()` serialises correctly.

### Canvas dimensions

- Width: 0–576px, Height: 0–288px
- Text content max: 1000 chars at startup, 2000 chars for `textContainerUpgrade`
- `containerName`: max 16 characters

### List container for navigation menus

Use `ListContainerProperty` + `ListItemContainerProperty` for Up/Down navigable lists. Handle `listEvent.eventType === OsEventTypeList.CLICK_EVENT` to confirm selection; use `currentSelectItemIndex` to identify which item. Max 20 items, each name max 64 chars.

```ts
new ListContainerProperty({
  ...,
  isEventCapture: 1,
  itemContainer: new ListItemContainerProperty({
    itemCount: items.length,
    itemWidth: 0,          // 0 = auto-fill width
    isItemSelectBorderEn: 1,
    itemName: items,
  }),
})
```

### `isEventCapture`

Set to `1` on the single interactive container. If there are multiple containers, exactly one must have `isEventCapture: 1`.

### Debugging glasses issues

Add `console.log` before the bridge call and inspect DevTools from inside the simulator's Browser window (not a separate Chrome tab). Key log to look for: `[Simulator] Flutter Bridge intercepted: evenAppMessage` confirms the simulator is receiving the call.

If `rebuildPageContainer` returns `false`, check container dimensions and field constraints above.
