import type { PostHog } from 'posthog-js'

let client: Promise<PostHog> | null = null

export function initializeAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY?.trim()
  if (!key || client) return
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
  if (!client) return
  void client.then(posthog => posthog.capture(event, properties))
}
