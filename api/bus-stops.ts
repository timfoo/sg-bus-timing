import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.LTA_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'LTA_API_KEY not set' })

  const skip = (req.query['$skip'] as string) ?? '0'
  const upstream = await fetch(
    `https://datamall2.mytransport.sg/ltaodataservice/v3/BusStops?$skip=${skip}`,
    { headers: { AccountKey: apiKey } }
  )

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `LTA API error: ${upstream.status}` })
  }

  return res.json(await upstream.json())
}
