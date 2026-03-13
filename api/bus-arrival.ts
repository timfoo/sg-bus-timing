import type { VercelRequest, VercelResponse } from '@vercel/node'

const LTA_URL = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival'
const BUS_STOP_CODE_RE = /^\d{5}$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const apiKey = process.env.LTA_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' })

  const { BusStopCode } = req.query
  if (typeof BusStopCode !== 'string' || !BUS_STOP_CODE_RE.test(BusStopCode)) {
    return res.status(400).json({ error: 'BusStopCode must be a 5-digit number' })
  }

  const upstream = await fetch(`${LTA_URL}?BusStopCode=${BusStopCode}`, {
    headers: { AccountKey: apiKey },
  })

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `LTA API error: ${upstream.status}` })
  }

  const data = await upstream.json()
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10')
  return res.status(200).json(data)
}
