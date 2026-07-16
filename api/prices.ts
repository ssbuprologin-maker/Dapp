import type { VercelRequest, VercelResponse } from '@vercel/node'

async function spotPrice(asset: 'SOL' | 'ETH' | 'USDC') {
  const result = await fetch(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`, {
    headers: { Accept: 'application/json', 'User-Agent': 'testnet-games-vercel/1.0' },
    signal: AbortSignal.timeout(4_000),
  })
  const body = await result.json() as { data?: { amount?: string } }
  const price = Number(body.data?.amount)
  if (!result.ok || !Number.isFinite(price) || price <= 0) throw new Error(`${asset} price is unavailable.`)
  return price
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
  response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
  const [sol, eth, usdc] = await Promise.allSettled([spotPrice('SOL'), spotPrice('ETH'), spotPrice('USDC')])
  if (sol.status === 'rejected' && eth.status === 'rejected') return response.status(503).json({ message: 'Live prices are temporarily unavailable.' })
  return response.status(200).json({
    solUsd: sol.status === 'fulfilled' ? sol.value : null,
    ethUsd: eth.status === 'fulfilled' ? eth.value : null,
    usdcUsd: usdc.status === 'fulfilled' ? usdc.value : 1,
    updatedAt: Date.now(),
  })
}
