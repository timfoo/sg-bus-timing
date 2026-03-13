import {
  waitForEvenAppBridge,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

const MAX_DIST_M = 500
const MAX_STOPS = 8
const AUTO_REFRESH_MS = 30_000

// ── Types ──────────────────────────────────────────────────────────────────────
interface BusStop {
  BusStopCode: string
  RoadName: string
  Description: string
  Latitude: number
  Longitude: number
  distance: number
}

interface BusArrival {
  EstimatedArrival: string
}

interface BusService {
  ServiceNo: string
  NextBus: BusArrival
  NextBus2: BusArrival
  NextBus3: BusArrival
}

interface LtaResponse {
  BusStopCode: string
  Services: BusService[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function minutesFromNow(iso: string): number {
  if (!iso) return -1
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
}

function formatArrival(iso: string): string {
  const m = minutesFromNow(iso)
  if (!iso || m < 0) return '-'
  return m === 0 ? 'Arr' : `${m}min`
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchAllBusStops(): Promise<Omit<BusStop, 'distance'>[]> {
  const cached = sessionStorage.getItem('busStops')
  if (cached) return JSON.parse(cached)

  const stops: Omit<BusStop, 'distance'>[] = []
  let skip = 0
  while (true) {
    const res = await fetch(`/api/bus-stops?$skip=${skip}`)
    if (!res.ok) throw new Error(`Bus stops fetch failed: ${res.status}`)
    const { value = [] } = await res.json()
    stops.push(...value)
    if (value.length < 500) break
    skip += 500
  }
  sessionStorage.setItem('busStops', JSON.stringify(stops))
  return stops
}

async function findNearbyStops(lat: number, lng: number): Promise<BusStop[]> {
  const all = await fetchAllBusStops()
  return all
    .map(s => ({ ...s, distance: Math.round(distanceM(lat, lng, s.Latitude, s.Longitude)) }))
    .filter(s => s.distance <= MAX_DIST_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_STOPS)
}

async function fetchArrivals(stopCode: string): Promise<LtaResponse> {
  const res = await fetch(`/api/bus-arrival?BusStopCode=${stopCode}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

function getGPS(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(p => resolve(p.coords), reject, { timeout: 10000 })
  )
}

// ── Glasses rendering ─────────────────────────────────────────────────────────
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

async function glassesStopList(bridge: Bridge, stops: BusStop[]) {
  const itemName = stops.map(s => `${s.BusStopCode} ${s.Description}`)
  try {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        listObject: [
          new ListContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            containerID: 1,
            containerName: 'stop-list',
            isEventCapture: 1,
            itemContainer: new ListItemContainerProperty({
              itemCount: itemName.length,
              itemWidth: 0,
              isItemSelectBorderEn: 1,
              itemName,
            }),
          }),
        ],
      })
    )
  } catch { /* glasses not connected */ }
}

async function glassesArrivals(bridge: Bridge, stop: BusStop, data: LtaResponse) {
  const lines = data.Services.slice(0, 4).map(svc => {
    const times = [svc.NextBus, svc.NextBus2, svc.NextBus3]
      .map(b => formatArrival(b?.EstimatedArrival))
      .filter(a => a !== '-')
      .join('  ')
    return `${svc.ServiceNo.padEnd(6)}${times}`
  })
  const header = `${stop.BusStopCode} ${stop.Description}`.substring(0, 28)
  const content = [header, ...lines].join('\n') || 'No buses'

  try {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            containerID: 2,
            containerName: 'arrivals',
            content,
            isEventCapture: 1,
          }),
        ],
      })
    )
  } catch { /* glasses not connected */ }
}

// ── Browser UI ────────────────────────────────────────────────────────────────
function setStatus(msg: string) {
  document.getElementById('status')!.textContent = msg
}

function setError(msg: string) {
  document.getElementById('error')!.textContent = msg
}

function renderStops(stops: BusStop[], onSelect: (s: BusStop) => void) {
  const el = document.getElementById('results')!
  document.getElementById('stop-name')!.textContent = `${stops.length} stops within 500m`
  el.innerHTML = stops
    .map(
      (_, i) => `<div class="bus-card" data-idx="${i}" style="cursor:pointer">
        <div class="bus-number" style="font-size:14px;min-width:52px">${stops[i].BusStopCode}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">${stops[i].Description}</div>
          <div style="font-size:12px;color:#888">${stops[i].RoadName} · ${stops[i].distance}m</div>
        </div>
      </div>`
    )
    .join('')
  el.querySelectorAll<HTMLElement>('.bus-card').forEach((card, i) =>
    card.addEventListener('click', () => onSelect(stops[i]))
  )
}

function renderArrivals(stop: BusStop, data: LtaResponse) {
  const el = document.getElementById('results')!
  document.getElementById('stop-name')!.textContent = `${stop.BusStopCode} · ${stop.Description}`
  if (!data.Services?.length) {
    el.innerHTML = '<p style="color:#555;font-size:13px;text-align:center">No buses in service</p>'
    return
  }
  el.innerHTML = data.Services.map(svc => {
    const chips = [svc.NextBus, svc.NextBus2, svc.NextBus3]
      .map(b => formatArrival(b?.EstimatedArrival))
      .filter(a => a !== '-')
      .map(a => `<span class="arrival-chip ${a === 'Arr' ? 'arriving' : ''}">${a}</span>`)
      .join('')
    return `<div class="bus-card">
      <div class="bus-number">${svc.ServiceNo}</div>
      <div class="arrivals">${chips}</div>
    </div>`
  }).join('')
  setStatus(`Updated ${new Date().toLocaleTimeString('en-SG')}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let bridge: Bridge | null = null
  try {
    bridge = await waitForEvenAppBridge()
  } catch { /* browser without glasses */ }

  let stops: BusStop[] = []
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  const backBtn = document.getElementById('back-btn') as HTMLButtonElement

  function clearRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  }

  async function loadArrivals(stop: BusStop) {
    clearRefresh()
    setError('')
    backBtn.style.display = 'inline-block'
    try {
      const data = await fetchArrivals(stop.BusStopCode)
      renderArrivals(stop, data)
      if (bridge) await glassesArrivals(bridge, stop, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    }
    refreshTimer = setInterval(async () => {
      try {
        const data = await fetchArrivals(stop.BusStopCode)
        renderArrivals(stop, data)
        if (bridge) await glassesArrivals(bridge, stop, data)
      } catch { /* ignore refresh errors */ }
    }, AUTO_REFRESH_MS)
  }

  async function showStops() {
    clearRefresh()
    backBtn.style.display = 'none'
    renderStops(stops, loadArrivals)
    if (bridge) await glassesStopList(bridge, stops)
  }

  if (bridge) {
    bridge.onEvenHubEvent(event => {
      if (event.listEvent?.eventType === OsEventTypeList.CLICK_EVENT) {
        const idx = event.listEvent.currentSelectItemIndex ?? 0
        if (stops[idx]) loadArrivals(stops[idx])
      } else if (event.textEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        showStops()
      }
    })
  }

  backBtn.addEventListener('click', showStops)

  setStatus('Getting location...')
  setError('')
  try {
    const coords = await getGPS()
    setStatus('Finding nearby stops...')
    stops = await findNearbyStops(coords.latitude, coords.longitude)
    if (!stops.length) {
      setError('No bus stops found within 500m')
      setStatus('')
      return
    }
    await showStops()
    setStatus('')
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Location failed')
    setStatus('')
  }
}

main()
