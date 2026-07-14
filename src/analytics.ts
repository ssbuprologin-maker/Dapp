import type { PostHog } from 'posthog-js'

let client: Promise<PostHog> | null = null
let initialized = false
let visitorId = ''
let sessionStartedAt = Date.now()

const VISITOR_KEY = 'testnet-games:anonymous-analytics-id'

function redisPayload(event: string, properties?: AnalyticsProperties) {
  return JSON.stringify({ event, visitor_id: visitorId, properties })
}

function sendToRedis(event: string, properties?: AnalyticsProperties, beacon = false) {
  const payload = redisPayload(event, properties)
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics', new Blob([payload], { type: 'application/json' }))
    return
  }
  void fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => { /* Analytics must never interrupt wallet or game actions. */ })
}

export function initializeAnalytics() {
  if (initialized) return
  initialized = true
  try {
    visitorId = localStorage.getItem(VISITOR_KEY) || crypto.randomUUID()
    localStorage.setItem(VISITOR_KEY, visitorId)
  } catch { visitorId = crypto.randomUUID() }
  sessionStartedAt = Date.now()
  sendToRedis('site_visit')
  window.addEventListener('pagehide', () => {
    sendToRedis('session_ended', {
      duration_seconds: Math.max(1, Math.round((Date.now() - sessionStartedAt) / 1000)),
    }, true)
  }, { once: true })

  const key = import.meta.env.VITE_POSTHOG_KEY?.trim()
  if (!key) return
  client = import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      person_profiles: 'identified_only',
    })
    return posthog
  })
}

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>

export function trackAnalytics(event: string, properties?: AnalyticsProperties) {
  sendToRedis(event, properties)
  if (client) void client.then(posthog => posthog.capture(event, properties))
}
