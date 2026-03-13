import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
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
  const params = new URLSearchParams(location.search)
  const lat = parseFloat(params.get('lat') ?? '')
  const lng = parseFloat(params.get('lng') ?? '')
  if (!isNaN(lat) && !isNaN(lng)) {
    return Promise.resolve({ latitude: lat, longitude: lng } as GeolocationCoordinates)
  }
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(p => resolve(p.coords), reject, { timeout: 10000 })
  )
}

// ── Glasses rendering ─────────────────────────────────────────────────────────
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

// Container ID constants
const CID_STOP_TITLE = 1
const CID_STOP_COUNT = 2
const CID_STOP_LIST  = 3
const CID_ARR_LIST   = 4
const CID_FAV_LIST   = 5

// ── Stop list view ────────────────────────────────────────────────────────────
async function glassesStopList(bridge: Bridge, stops: BusStop[]) {
  const rows = [
    `★  FAVORITES`,
    ...stops.map(s => `${s.BusStopCode}  ${s.Description}  (${s.distance}m)`),
  ]
  const items = [...rows, ...Array(Math.max(0, 8 - rows.length)).fill('')]
  try {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          xPosition: 0, yPosition: 0, width: 380, height: 40,
          containerID: CID_STOP_TITLE, containerName: 'stop-title',
          borderWidth: 0, content: 'NEARBY STOPS',
        }),
        new TextContainerProperty({
          xPosition: 380, yPosition: 0, width: 196, height: 40,
          containerID: CID_STOP_COUNT, containerName: 'stop-count',
          borderWidth: 0, content: `${stops.length} stops <=500m`,
        }),
      ],
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 40, width: 576, height: 248,
        containerID: CID_STOP_LIST, containerName: 'stop-list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length, itemWidth: 576,
          isItemSelectBorderEn: 1, itemName: items,
        }),
      })],
    }))
  } catch (e) { console.error('[glasses] stop list error:', e) }
}

// ── Favorites view ────────────────────────────────────────────────────────────
async function glassesFavorites(bridge: Bridge, favStops: BusStop[]) {
  const rows = favStops.length
    ? [
        `← BACK`,
        ...favStops.map(s => `${s.BusStopCode}  ${s.Description}  ${s.RoadName}`),
      ]
    : [
        `← BACK`,
        'No favorites yet.',
        'View arrivals on glasses,',
        'then double-click to save.',
      ]
  const items = [...rows, ...Array(Math.max(0, 8 - rows.length)).fill('')]
  try {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          xPosition: 0, yPosition: 0, width: 380, height: 40,
          containerID: CID_STOP_TITLE, containerName: 'fav-title',
          borderWidth: 0, content: 'FAVORITES',
        }),
        new TextContainerProperty({
          xPosition: 380, yPosition: 0, width: 196, height: 40,
          containerID: CID_STOP_COUNT, containerName: 'fav-count',
          borderWidth: 0, content: favStops.length ? `${favStops.length} saved` : 'none saved',
        }),
      ],
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 40, width: 576, height: 248,
        containerID: CID_FAV_LIST, containerName: 'fav-list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length, itemWidth: 576,
          isItemSelectBorderEn: favStops.length > 0 ? 1 : 0,
          itemName: items,
        }),
      })],
    }))
  } catch (e) { console.error('[glasses] favorites error:', e) }
}

// ── Arrivals view ─────────────────────────────────────────────────────────────
async function glassesArrivals(bridge: Bridge, stop: BusStop, data: LtaResponse) {
  const updated = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
  const sorted = [...(data.Services ?? [])].sort((a, b) =>
    a.ServiceNo.localeCompare(b.ServiceNo, undefined, { numeric: true })
  )
  const svcRows = sorted.map(svc => {
    const n1 = formatArrival(svc.NextBus?.EstimatedArrival).padEnd(12)
    const n2 = formatArrival(svc.NextBus2?.EstimatedArrival).padEnd(12)
    const n3 = formatArrival(svc.NextBus3?.EstimatedArrival)
    return `${svc.ServiceNo.padEnd(10)}${n1}${n2}${n3}`
  })
  const rows = [
    `< ${stop.BusStopCode}  ${stop.Description}  (updated: ${updated})`,
    `SVC       NEXT        2ND         3RD`,
    ...(svcRows.length ? svcRows : ['No services in operation']),
  ]
  const items = [...rows, ...Array(Math.max(0, 8 - rows.length)).fill('')]
  try {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 1,
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        containerID: CID_ARR_LIST, containerName: 'arrivals',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length, itemWidth: 576,
          isItemSelectBorderEn: 0, itemName: items,
        }),
      })],
    }))
  } catch (e) { console.error('[glasses] arrivals error:', e) }
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

function renderFavStops(favStops: BusStop[], onSelect: (s: BusStop) => void) {
  const el = document.getElementById('results')!
  document.getElementById('stop-name')!.textContent = `${favStops.length} favorite stops`
  if (!favStops.length) {
    el.innerHTML = '<p style="color:#555;font-size:13px;text-align:center;padding:20px">No favorites yet.<br><br>View a stop\'s arrivals on the glasses, then double-click to save it.</p>'
    return
  }
  el.innerHTML = favStops
    .map(
      (_, i) => `<div class="bus-card" data-idx="${i}" style="cursor:pointer">
        <div class="bus-number" style="font-size:14px;min-width:52px">${favStops[i].BusStopCode}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">${favStops[i].Description}</div>
          <div style="font-size:12px;color:#888">${favStops[i].RoadName}</div>
        </div>
        <div style="font-size:18px;color:gold;padding-left:8px">★</div>
      </div>`
    )
    .join('')
  el.querySelectorAll<HTMLElement>('.bus-card').forEach((card, i) =>
    card.addEventListener('click', () => onSelect(favStops[i]))
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

  // ── Favorites state ────────────────────────────────────────────────────────
  let favoriteStopCodes: string[] = []
  let currentStop: BusStop | null = null
  let listView: 'nearby' | 'favorites' = 'nearby'

  if (bridge) {
    try {
      const raw = await bridge.getLocalStorage('favorites')
      favoriteStopCodes = raw ? JSON.parse(raw) : []
    } catch { /* no saved favorites */ }
  }

  async function getFavStops(): Promise<BusStop[]> {
    const all = await fetchAllBusStops()
    return favoriteStopCodes
      .map(code => {
        const s = all.find(x => x.BusStopCode === code)
        return s ? { ...s, distance: 0 } : null
      })
      .filter(Boolean) as BusStop[]
  }

  async function toggleFavorite(stop: BusStop) {
    const idx = favoriteStopCodes.indexOf(stop.BusStopCode)
    if (idx >= 0) {
      favoriteStopCodes.splice(idx, 1)
      setStatus(`Removed ${stop.BusStopCode} from favorites`)
    } else {
      favoriteStopCodes.push(stop.BusStopCode)
      setStatus(`★ Added ${stop.BusStopCode} to favorites`)
    }
    if (bridge) {
      try { await bridge.setLocalStorage('favorites', JSON.stringify(favoriteStopCodes)) } catch { /* ignore */ }
    }
    setTimeout(() => setStatus(''), 2000)
  }

  // ──────────────────────────────────────────────────────────────────────────

  function clearRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  }

  async function loadArrivals(stop: BusStop) {
    clearRefresh()
    currentStop = stop
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
    listView = 'nearby'
    backBtn.style.display = 'none'
    renderStops(stops, loadArrivals)
    if (bridge) await glassesStopList(bridge, stops)
  }

  async function showFavorites() {
    clearRefresh()
    listView = 'favorites'
    backBtn.style.display = 'none'
    const favStops = await getFavStops()
    renderFavStops(favStops, loadArrivals)
    if (bridge) await glassesFavorites(bridge, favStops)
  }


  if (bridge) {
    try {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
        containerTotalNum: 0,
        imageObject: [],
        listObject: [],
      }))
    } catch { /* ignore */ }

    bridge.onEvenHubEvent(event => {
      const listType = event.listEvent?.eventType
      const name     = event.listEvent?.containerName
      const isClick  = event.listEvent != null &&
        (listType == null || listType === OsEventTypeList.CLICK_EVENT)
      const isDoubleClick = listType === OsEventTypeList.DOUBLE_CLICK_EVENT

      if (name === 'arrivals') {
        if (isDoubleClick && currentStop) {
          toggleFavorite(currentStop)
        } else if (isClick) {
          if (listView === 'favorites') showFavorites()
          else showStops()
        }
      } else if (name === 'stop-list') {
        const idx = event.listEvent?.currentSelectItemIndex
        if (isClick) {
          if (idx == null) { showFavorites(); return }  // SDK omits index for first item
          const target = stops[idx - 1]
          if (target) loadArrivals(target)
        }
      } else if (name === 'fav-list') {
        const idx = event.listEvent?.currentSelectItemIndex
        if (isClick) {
          if (idx == null) { showStops(); return }  // SDK omits index for first item (← BACK)
          getFavStops().then(favStops => {
            const target = favStops[idx - 1]
            if (target) loadArrivals(target)
            // if no target: no favorites saved, ignore click on instruction rows
          })
        }
      }
    })
  }

  backBtn.addEventListener('click', () => {
    if (listView === 'favorites') showFavorites()
    else showStops()
  })

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
