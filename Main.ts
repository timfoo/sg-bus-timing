import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
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

function glassCell(iso: string): string {
  if (!iso) return '---'.padEnd(6)
  const m = minutesFromNow(iso)
  if (m < 0) return '---'.padEnd(6)
  return (m === 0 ? 'Arr' : `${m}min`).padEnd(6)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function canvasToGray4(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, 576, 288)
  const out: number[] = []
  for (let i = 0; i < 576 * 288 * 4; i += 8) {
    const l1 = Math.min(15, Math.round((data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) / (255 * 17)))
    const l2 = Math.min(15, Math.round((data[i + 4] * 77 + data[i + 5] * 150 + data[i + 6] * 29) / (255 * 17)))
    out.push((l1 << 4) | l2)
  }
  return out
}

function drawStopListCanvas(stops: BusStop[], selectedIdx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 576
  canvas.height = 288
  const ctx = canvas.getContext('2d')!

  // Black background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 576, 288)

  // ── Header bar (y:0 h:38) ──
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, 576, 38)
  // Bottom border
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 38)
  ctx.lineTo(576, 38)
  ctx.stroke()
  // Left: "◎  NEARBY STOPS"
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 15px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('◎  NEARBY STOPS', 12, 19)
  // Right: "${n} found  ·  ≤500m"
  ctx.fillStyle = '#888'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`${stops.length} found  ·  ≤500m`, 564, 19)

  // ── Stop rows (y:42, each row h:28) ──
  const ROW_H = 28
  const ROW_Y0 = 42

  stops.slice(0, 8).forEach((stop, i) => {
    const rowY = ROW_Y0 + i * ROW_H
    const isSelected = selectedIdx === i + 1

    if (isSelected) {
      // Selected row fill
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, rowY, 576, ROW_H)
      // White rounded border
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      roundRect(ctx, 1, rowY + 1, 574, ROW_H - 2, 3)
      ctx.stroke()
    } else {
      // Bottom separator
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, rowY + ROW_H - 1)
      ctx.lineTo(576, rowY + ROW_H - 1)
      ctx.stroke()
    }

    const midY = rowY + ROW_H / 2

    // Col 1: stop code (x:10, w:52)
    ctx.fillStyle = isSelected ? '#fff' : '#aaa'
    ctx.font = 'bold 13px monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(stop.BusStopCode, 10, midY)

    // Vertical divider at x:64
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(64, rowY + 4)
    ctx.lineTo(64, rowY + ROW_H - 4)
    ctx.stroke()

    // Col 2: description (x:70, truncate to x:490)
    ctx.fillStyle = isSelected ? '#fff' : '#bbb'
    ctx.font = isSelected ? 'bold 13px sans-serif' : '13px sans-serif'
    ctx.textAlign = 'left'
    // Measure and truncate with ellipsis
    const maxDescW = 490 - 70
    let desc = stop.Description
    if (ctx.measureText(desc).width > maxDescW) {
      while (desc.length > 0 && ctx.measureText(desc + '…').width > maxDescW) {
        desc = desc.slice(0, -1)
      }
      desc += '…'
    }
    ctx.fillText(desc, 70, midY)

    // Col 3: distance badge (x:492, w:72, h:16, r:8)
    const badgeFill = isSelected ? '#333' : '#1a1a1a'
    const badgeStroke = isSelected ? '#888' : '#333'
    ctx.fillStyle = badgeFill
    roundRect(ctx, 492, rowY + 6, 72, 16, 8)
    ctx.fill()
    ctx.strokeStyle = badgeStroke
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = isSelected ? '#ccc' : '#888'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`${stop.distance}m`, 558, midY)
  })

  // ── Detail bar (y:264 h:24) ──
  // Top border
  ctx.strokeStyle = '#2a2a2a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 264)
  ctx.lineTo(576, 264)
  ctx.stroke()

  ctx.font = '11px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const selectedStop = selectedIdx >= 1 ? stops[selectedIdx - 1] : null
  if (selectedStop) {
    ctx.fillStyle = '#777'
    ctx.fillText(
      `◎  ${selectedStop.BusStopCode}  ${selectedStop.Description}  ·  ${selectedStop.RoadName}  ·  ${selectedStop.distance}m`,
      8, 276
    )
  } else {
    ctx.fillStyle = '#444'
    ctx.fillText('  ↑↓ Navigate   ·   Click to select', 8, 276)
  }

  return canvas
}

function drawArrivalsCanvas(stop: BusStop, data: LtaResponse, updated: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 576
  canvas.height = 288
  const ctx = canvas.getContext('2d')!

  // Black background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 576, 288)

  // ── Back button card (y:6, x:6, w:564, h:42, r:6) ──
  ctx.fillStyle = '#0f0f0f'
  roundRect(ctx, 6, 6, 564, 42, 6)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  roundRect(ctx, 6, 6, 564, 42, 6)
  ctx.stroke()

  ctx.textBaseline = 'middle'

  // "◂" back arrow
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('◂', 18, 27)

  // Stop code
  ctx.font = 'bold 13px monospace'
  ctx.fillStyle = '#fff'
  ctx.fillText(stop.BusStopCode, 36, 27)

  // Stop name (truncated to 320px from x:96)
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#ddd'
  const maxNameW = 320
  let stopName = stop.Description
  if (ctx.measureText(stopName).width > maxNameW) {
    while (stopName.length > 0 && ctx.measureText(stopName + '…').width > maxNameW) {
      stopName = stopName.slice(0, -1)
    }
    stopName += '…'
  }
  ctx.fillText(stopName, 96, 27)

  // Updated time right-aligned at x:562
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#555'
  ctx.textAlign = 'right'
  ctx.fillText(updated, 562, 27)

  // ── Column header (y:54 h:26) ──
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 54, 576, 26)
  // Bottom border
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 80)
  ctx.lineTo(576, 80)
  ctx.stroke()

  // Vertical separator lines (y:54 to y:288)
  ctx.strokeStyle = '#1a1a1a'
  ;[100, 220, 340].forEach(x => {
    ctx.beginPath()
    ctx.moveTo(x, 54)
    ctx.lineTo(x, 288)
    ctx.stroke()
  })

  // Column labels
  ctx.font = 'bold 11px sans-serif'
  ctx.fillStyle = '#555'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const colLabels = ['SVC', 'NEXT', '2ND', '3RD']
  const colX = [12, 108, 228, 348]
  colLabels.forEach((label, i) => ctx.fillText(label, colX[i], 67))

  // ── Service rows (y:80) ──
  const services = data.Services.slice(0, 8)
  const rowH = Math.floor((288 - 80) / Math.max(1, services.length))

  services.forEach((svc, i) => {
    const rowY = 80 + i * rowH

    // Alternating row bg
    if (i % 2 === 0) {
      ctx.fillStyle = '#070707'
      ctx.fillRect(0, rowY, 576, rowH)
    }

    // Row top separator
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, rowY)
    ctx.lineTo(576, rowY)
    ctx.stroke()

    const midY = rowY + rowH / 2
    ctx.textBaseline = 'middle'

    // Bus number
    ctx.font = 'bold 15px monospace'
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.fillText(svc.ServiceNo, 12, midY)

    // NEXT arrival
    const nextM = minutesFromNow(svc.NextBus?.EstimatedArrival)
    if (svc.NextBus?.EstimatedArrival && nextM >= 0) {
      if (nextM === 0) {
        // "Arr" badge
        const badgeH = rowH * 0.7
        const badgeY = rowY + rowH * 0.15
        ctx.fillStyle = '#1c1c1c'
        roundRect(ctx, 108, badgeY, 38, badgeH, 4)
        ctx.fill()
        ctx.strokeStyle = '#555'
        ctx.lineWidth = 1
        roundRect(ctx, 108, badgeY, 38, badgeH, 4)
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText('Arr', 114, midY)
      } else {
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`${nextM}min`, 108, midY)
      }
    }

    // 2ND arrival
    const next2M = minutesFromNow(svc.NextBus2?.EstimatedArrival)
    if (svc.NextBus2?.EstimatedArrival && next2M >= 0) {
      ctx.fillStyle = '#888'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(next2M === 0 ? 'Arr' : `${next2M}min`, 228, midY)
    }

    // 3RD arrival
    const next3M = minutesFromNow(svc.NextBus3?.EstimatedArrival)
    if (svc.NextBus3?.EstimatedArrival && next3M >= 0) {
      ctx.fillStyle = '#555'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(next3M === 0 ? 'Arr' : `${next3M}min`, 348, midY)
    }
  })

  return canvas
}

async function glassesStopList(bridge: Bridge, stops: BusStop[], selectedIdx: number) {
  const canvas = drawStopListCanvas(stops, selectedIdx)
  const blankItems = Array(stops.length + 1).fill(' ')
  try {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 2,
      imageObject: [new ImageContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        containerID: 1, containerName: 'img-stops',
      })],
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 287, width: 576, height: 1,
        containerID: 2, containerName: 'stop-list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: blankItems.length, itemWidth: 0,
          isItemSelectBorderEn: 0, itemName: blankItems,
        }),
      })],
    }))
    await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 1,
      imageData: canvasToGray4(canvas),
    }))
  } catch { /* ignore */ }
}

async function refreshStopImage(bridge: Bridge, stops: BusStop[], selectedIdx: number) {
  const canvas = drawStopListCanvas(stops, selectedIdx)
  try {
    await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 1,
      imageData: canvasToGray4(canvas),
    }))
  } catch { /* ignore */ }
}

async function glassesArrivals(bridge: Bridge, stop: BusStop, data: LtaResponse) {
  const updated = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
  const canvas = drawArrivalsCanvas(stop, data, updated)
  try {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 2,
      imageObject: [new ImageContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        containerID: 3, containerName: 'img-arrivals',
      })],
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 287, width: 576, height: 1,
        containerID: 4, containerName: 'arrivals',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: 1, itemWidth: 0,
          isItemSelectBorderEn: 0, itemName: [' '],
        }),
      })],
    }))
    await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 3,
      imageData: canvasToGray4(canvas),
    }))
  } catch { /* ignore */ }
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
    selectedStopIdx = 0
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
    selectedStopIdx = 0
    backBtn.style.display = 'none'
    renderStops(stops, loadArrivals)
    if (bridge) await glassesStopList(bridge, stops, selectedStopIdx)
  }

  let selectedStopIdx = 0

  if (bridge) {
    bridge.onEvenHubEvent(event => {
      const listType = event.listEvent?.eventType
      const name     = event.listEvent?.containerName
      const isClick  = event.listEvent != null &&
        (listType == null || listType === OsEventTypeList.CLICK_EVENT)

      if (name === 'arrivals') {
        if (isClick) showStops()
      } else if (name === 'stop-list') {
        if (listType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          selectedStopIdx = Math.min(stops.length, selectedStopIdx + 1)
          refreshStopImage(bridge!, stops, selectedStopIdx)
        } else if (listType === OsEventTypeList.SCROLL_TOP_EVENT) {
          selectedStopIdx = Math.max(0, selectedStopIdx - 1)
          refreshStopImage(bridge!, stops, selectedStopIdx)
        } else if (isClick) {
          const target = stops[selectedStopIdx - 1]
          if (target) loadArrivals(target)
        }
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
