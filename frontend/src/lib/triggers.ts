import { parseISO } from 'date-fns'
import {
  extractIngredients,
  normalizeTags,
  type FoodLogRecord,
  type IngredientRecord,
  type SymptomLogRecord,
} from './tracker'

const ACUTE_MIN_TYPE = 6
const ACUTE_MAX_TYPE = 8
const CLUSTER_WINDOW_HOURS = 3
const SYMPTOM_LOOKBACK_HOURS = 48
const FAST_WINDOW_HOURS = 4
const MEDIUM_WINDOW_HOURS = 24
const MS_PER_HOUR = 60 * 60 * 1000
const CONFIDENCE_STEEPNESS = 0.5

const TAG_MULTIPLIERS = {
  Dairy: 1.5,
  'High-Fat': 1.4,
  FODMAP: 1.35,
  Allium: 1.35,
  Fructans: 1.35,
  'High-Histamine': 1.3,
  'processed meat': 1.25,
  Nightshade: 1.2,
  Soy: 1.2,
  Gluten: 1.2,
  'wheat flour': 1.2,
  Nut: 1.15,
  soup: 1,
  Protein: 1,
  'high-sodium': 1,
  Salted: 1,
  'Low-Risk': 0.5,
  Safe: 0.3,
} as const

const normalizedTagMultipliers = new Map(
  Object.entries(TAG_MULTIPLIERS).map(([tag, multiplier]) => [tag.toLowerCase(), multiplier] as const),
)

type ParsedSymptomLog = {
  log: SymptomLogRecord
  occurredAtMs: number
}

type ParsedMealLog = {
  log: FoodLogRecord
  consumedAtMs: number
  ingredients: IngredientRecord[]
}

export type DiarrheaWindow = 'fast' | 'medium' | 'slow'

export type DiarrheaIngredientRow = {
  ingredientId: string
  ingredientName: string
  symptomExposure: number
  safeExposure: number
  rawRri: number
  confidenceMultiplier: number
  rri: number
  classification: 'high' | 'neutral' | 'safe'
  fastHits: number
  mediumHits: number
  slowHits: number
  observationCount: number
}

export type DiarrheaLagPoint = {
  eventId: string
  eventOccurredAt: string
  eventType: number
  mealId: string
  mealName: string
  consumedAt: string
  lagHours: number
  window: DiarrheaWindow
  windowWeight: number
  ingredientNames: string[]
}

export type DiarrheaEventCluster = {
  eventId: string
  occurredAt: string
  eventTypes: number[]
  symptomIds: string[]
}

export type DiarrheaAnalysis = {
  acuteEventCount: number
  clusteredEventCount: number
  eventClusters: DiarrheaEventCluster[]
  ingredientRows: DiarrheaIngredientRow[]
  lagPoints: DiarrheaLagPoint[]
}

type IngredientStat = {
  ingredientId: string
  ingredientName: string
  symptomExposure: number
  safeExposure: number
  fastHits: number
  mediumHits: number
  slowHits: number
}

type EventCluster = {
  eventId: string
  occurredAtMs: number
  symptomLogs: SymptomLogRecord[]
}

const parseTimestamp = (value: string) => {
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const roundToThreeDecimals = (value: number) => Math.round(value * 1000) / 1000
const applyConfidenceCurve = (rawRisk: number, observations: number) =>
  rawRisk * (1 - Math.exp(-CONFIDENCE_STEEPNESS * observations))

const getIngredientKey = (ingredient: IngredientRecord) =>
  ingredient.id || ingredient.name.trim().toLowerCase()

const getIngredientName = (ingredient: IngredientRecord) =>
  ingredient.name.trim() || ingredient.id || 'Unknown ingredient'

const getIngredientTagMultiplier = (ingredient: IngredientRecord) => {
  const tags = normalizeTags(ingredient.tags)

  return tags.reduce((highestMultiplier, tag) => {
    const multiplier = normalizedTagMultipliers.get(tag.toLowerCase())
    return multiplier === undefined ? highestMultiplier : Math.max(highestMultiplier, multiplier)
  }, 1)
}

const buildIngredientIndex = (ingredients: IngredientRecord[]) => {
  const rows = new Map<string, IngredientStat>()

  for (const ingredient of ingredients) {
    const ingredientId = getIngredientKey(ingredient)
    if (!ingredientId) {
      continue
    }

    if (!rows.has(ingredientId)) {
      rows.set(ingredientId, {
        ingredientId,
        ingredientName: getIngredientName(ingredient),
        symptomExposure: 0,
        safeExposure: 0,
        fastHits: 0,
        mediumHits: 0,
        slowHits: 0,
      })
    }
  }

  return rows
}

const ensureIngredientStat = (
  stats: Map<string, IngredientStat>,
  ingredient: IngredientRecord,
): IngredientStat => {
  const ingredientId = getIngredientKey(ingredient)
  const ingredientName = getIngredientName(ingredient)
  const existing = stats.get(ingredientId)

  if (existing) {
    if (!existing.ingredientName && ingredientName) {
      existing.ingredientName = ingredientName
    }
    return existing
  }

  const created = {
    ingredientId,
    ingredientName,
    symptomExposure: 0,
    safeExposure: 0,
    fastHits: 0,
    mediumHits: 0,
    slowHits: 0,
  }

  stats.set(ingredientId, created)
  return created
}

const classifyRri = (rri: number): 'high' | 'neutral' | 'safe' => {
  if (rri >= 0.7) return 'high'
  if (rri >= 0.3) return 'neutral'
  return 'safe'
}

const getWindowForLag = (lagHours: number): { window: DiarrheaWindow; weight: number } | null => {
  if (lagHours <= FAST_WINDOW_HOURS) {
    return { window: 'fast', weight: 1 }
  }

  if (lagHours <= MEDIUM_WINDOW_HOURS) {
    return { window: 'medium', weight: 0.8 }
  }

  if (lagHours <= SYMPTOM_LOOKBACK_HOURS) {
    return { window: 'slow', weight: 0.4 }
  }

  return null
}

const buildMealEntries = (foodLogs: FoodLogRecord[]) =>
  foodLogs
    .map((log) => {
      const consumedAt = parseTimestamp(log.consumed_at)
      if (!consumedAt) {
        return null
      }

      return {
        log,
        consumedAtMs: consumedAt.getTime(),
        ingredients: extractIngredients(log),
      } satisfies ParsedMealLog
    })
    .filter((entry): entry is ParsedMealLog => entry !== null)
    .sort((a, b) => a.consumedAtMs - b.consumedAtMs)

const clusterAcuteEvents = (symptomLogs: SymptomLogRecord[]) => {
  const acuteEvents = symptomLogs
    .filter((log) => log.bristol_type >= ACUTE_MIN_TYPE && log.bristol_type <= ACUTE_MAX_TYPE)
    .map((log) => {
      const occurredAt = parseTimestamp(log.occurred_at)
      return occurredAt ? { log, occurredAtMs: occurredAt.getTime() } : null
    })
    .filter((entry): entry is ParsedSymptomLog => entry !== null)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs)

  const clusters: EventCluster[] = []
  const clusterWindowMs = CLUSTER_WINDOW_HOURS * MS_PER_HOUR

  for (const event of acuteEvents) {
    const previousCluster = clusters[clusters.length - 1]
    if (!previousCluster) {
      clusters.push({
        eventId: event.log.id,
        occurredAtMs: event.occurredAtMs,
        symptomLogs: [event.log],
      })
      continue
    }

    if (event.occurredAtMs - previousCluster.occurredAtMs <= clusterWindowMs) {
      previousCluster.symptomLogs.push(event.log)
      continue
    }

    clusters.push({
      eventId: event.log.id,
      occurredAtMs: event.occurredAtMs,
      symptomLogs: [event.log],
    })
  }

  return { acuteEvents, clusters }
}

export function calculateDiarrheaTriggers(
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
  ingredients: IngredientRecord[],
): DiarrheaAnalysis {
  const { acuteEvents, clusters } = clusterAcuteEvents(symptomLogs)
  const mealEntries = buildMealEntries(foodLogs)
  const ingredientStats = buildIngredientIndex(ingredients)
  const lagPoints: DiarrheaLagPoint[] = []

  for (const cluster of clusters) {
    const clusterStart = cluster.occurredAtMs
    const lookbackStart = clusterStart - SYMPTOM_LOOKBACK_HOURS * MS_PER_HOUR
    const symptomTypes = cluster.symptomLogs.map((log) => log.bristol_type)

    for (const mealEntry of mealEntries) {
      if (mealEntry.consumedAtMs >= clusterStart || mealEntry.consumedAtMs < lookbackStart) {
        continue
      }

      const lagHours = (clusterStart - mealEntry.consumedAtMs) / MS_PER_HOUR
      const windowInfo = getWindowForLag(lagHours)
      if (!windowInfo) {
        continue
      }

      const mealIngredients = [
        ...new Map(
          mealEntry.ingredients
            .map((ingredient) => ({
              id: getIngredientKey(ingredient),
              name: getIngredientName(ingredient),
            }))
            .filter((ingredient) => ingredient.id && ingredient.name)
            .map((ingredient) => [ingredient.id, ingredient.name] as const),
        ).values(),
      ]

      lagPoints.push({
        eventId: cluster.eventId,
        eventOccurredAt: new Date(clusterStart).toISOString(),
        eventType: Math.max(...symptomTypes),
        mealId: mealEntry.log.id,
        mealName: mealEntry.log.meal_name || 'Meal',
        consumedAt: mealEntry.log.consumed_at,
        lagHours: roundToThreeDecimals(lagHours),
        window: windowInfo.window,
        windowWeight: windowInfo.weight,
        ingredientNames: mealIngredients,
      })

      const seenIngredientIds = new Set<string>()
      for (const ingredient of mealEntry.ingredients) {
        const ingredientId = getIngredientKey(ingredient)
        const ingredientName = getIngredientName(ingredient)
        if (!ingredientId || seenIngredientIds.has(ingredientId)) {
          continue
        }

        seenIngredientIds.add(ingredientId)
        const stat = ensureIngredientStat(ingredientStats, {
          id: ingredientId,
          name: ingredientName,
        })
        const tagMultiplier = getIngredientTagMultiplier(ingredient)

        stat.symptomExposure += windowInfo.weight * tagMultiplier
        if (windowInfo.window === 'fast') {
          stat.fastHits += 1
        } else if (windowInfo.window === 'medium') {
          stat.mediumHits += 1
        } else {
          stat.slowHits += 1
        }
      }
    }
  }

  const clusterStarts = clusters.map((cluster) => cluster.occurredAtMs).sort((a, b) => a - b)

  for (const mealEntry of mealEntries) {
    const isSafe = !clusterStarts.some(
      (clusterStart) =>
        mealEntry.consumedAtMs < clusterStart &&
        mealEntry.consumedAtMs + SYMPTOM_LOOKBACK_HOURS * MS_PER_HOUR >= clusterStart,
    )

    if (!isSafe) {
      continue
    }

    const seenIngredientIds = new Set<string>()
    for (const ingredient of mealEntry.ingredients) {
      const ingredientId = getIngredientKey(ingredient)
      const ingredientName = getIngredientName(ingredient)
      if (!ingredientId || seenIngredientIds.has(ingredientId)) {
        continue
      }

      seenIngredientIds.add(ingredientId)
      const stat = ensureIngredientStat(ingredientStats, {
        id: ingredientId,
        name: ingredientName,
      })
      stat.safeExposure += 1
    }
  }

  const ingredientRows = [...ingredientStats.values()]
    .map((stat) => {
      const rri = stat.symptomExposure + stat.safeExposure === 0
        ? 0
        : stat.symptomExposure / (stat.symptomExposure + stat.safeExposure)
      const observationCount = stat.fastHits + stat.mediumHits + stat.slowHits
      const adjustedRri = applyConfidenceCurve(rri, observationCount)

      return {
        ingredientId: stat.ingredientId,
        ingredientName: stat.ingredientName,
        symptomExposure: roundToThreeDecimals(stat.symptomExposure),
        safeExposure: roundToThreeDecimals(stat.safeExposure),
        rawRri: roundToThreeDecimals(rri),
        confidenceMultiplier: 1 - Math.exp(-CONFIDENCE_STEEPNESS * observationCount),
        rri: roundToThreeDecimals(adjustedRri),
        classification: classifyRri(adjustedRri),
        fastHits: stat.fastHits,
        mediumHits: stat.mediumHits,
        slowHits: stat.slowHits,
        observationCount,
      }
    })
    .sort(
      (a, b) =>
        b.rri - a.rri ||
        b.symptomExposure - a.symptomExposure ||
        a.ingredientName.localeCompare(b.ingredientName),
    )

  lagPoints.sort((a, b) => a.lagHours - b.lagHours || a.consumedAt.localeCompare(b.consumedAt))

  return {
    acuteEventCount: acuteEvents.length,
    clusteredEventCount: clusters.length,
    eventClusters: clusters.map((cluster) => ({
      eventId: cluster.eventId,
      occurredAt: new Date(cluster.occurredAtMs).toISOString(),
      eventTypes: cluster.symptomLogs.map((log) => log.bristol_type),
      symptomIds: cluster.symptomLogs.map((log) => log.id),
    })),
    ingredientRows,
    lagPoints,
  }
}
