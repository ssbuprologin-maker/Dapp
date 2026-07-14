import { Redis } from '@upstash/redis'

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

export const redis = url && token ? new Redis({ url, token }) : null

export function requireRedis() {
  if (!redis) {
    throw new Error('Connect an Upstash Redis database to Vercel. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are missing.')
  }
  return redis
}
