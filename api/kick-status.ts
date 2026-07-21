import type { VercelRequest, VercelResponse } from '@vercel/node'

type KickChannelResponse = { livestream?: { is_live?: boolean } | null }

const validSlug = (value: string) => /^[a-z0-9_-]{2,32}$/.test(value)

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
  const raw = Array.isArray(request.query.channels) ? request.query.channels.join(',') : request.query.channels ?? ''
  const channels = [...new Set(raw.split(',').map(value => value.trim().toLowerCase()).filter(validSlug))].slice(0, 20)
  const statuses = await Promise.all(channels.map(async slug => {
    try {
      const kickResponse = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'DINOGAME/1.0 live-status' },
        signal: AbortSignal.timeout(6_000),
      })
      if (!kickResponse.ok) return [slug, false] as const
      const channel = await kickResponse.json() as KickChannelResponse
      return [slug, channel.livestream?.is_live === true] as const
    } catch { return [slug, false] as const }
  }))
  return response.status(200).json({ channels: Object.fromEntries(statuses), checkedAt: Date.now() })
}
