export type LevelTier = 'iron' | 'emerald' | 'sapphire' | 'amethyst' | 'inferno' | 'legend'
export type ChatLevelTier = 'gray' | 'blue' | 'purple' | 'orange' | 'red' | 'rainbow'

export function levelTier(level: number): LevelTier {
  if (level >= 100) return 'legend'
  if (level >= 75) return 'inferno'
  if (level >= 50) return 'amethyst'
  if (level >= 25) return 'sapphire'
  if (level >= 10) return 'emerald'
  return 'iron'
}

export function chatLevelTier(level: number): ChatLevelTier {
  if (level >= 100) return 'rainbow'
  if (level >= 81) return 'red'
  if (level >= 51) return 'orange'
  if (level >= 21) return 'purple'
  if (level >= 6) return 'blue'
  return 'gray'
}
