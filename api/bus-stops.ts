import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const skip = (req.query['$skip'] as string) ?? '0'
  const upstream = await fetch(
    `https://datamall2.mytransport.sg/ltaodataservice/v3/BusStops?$skip=${skip}`,
    { headers: { AccountKey: process.env.LTA_API_KEY ?? '' } }
  )
  const data = await upstream.json()
  res.json(data)
}
