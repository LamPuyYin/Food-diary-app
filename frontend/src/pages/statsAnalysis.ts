import { parseISO } from 'date-fns'
import {
  extractIngredients,
  normalizeTags,
  type FoodLogRecord,
  type IngredientRecord,
  type SymptomLogRecord,
} from '../lib/tracker'

export type StatsWindow = 'fast' | 'medium' | 'slow'

export type StatsLagPoint = {
  eventId: string
  eventOccurredAt: string
  eventType: number
  mealId: string
  mealName: string
  consumedAt: string
  lagHours: number
  window: StatsWindow
  windowWeight: number
  ingredientNames: string[]
}

export type StatsIngredientRow = {
  ingredientId: string
  ingredientName: string
  symptomExposure: number
  safeExposure: number
  rawRiskPercent: number
  confidenceMultiplier: number
  riskPercent: number
  symptomObservationCount: number
  safeObservationCount: number
  observationCount: number
  classification: 'high' | 'neutral' | 'safe'
  tags: string[]
  averageLagHours: number | null
}

export type StatsAnalysis = {
  acuteEventCount: number
  controlEventCount: number
  ingredientRows: StatsIngredientRow[]
  lagPoints: StatsLagPoint[]
}

const LOOKBACK_HOURS = 48
const FAST_WINDOW_HOURS = 4
const MEDIUM_WINDOW_HOURS = 24
const CLUSTER_WINDOW_HOURS = 3
const MS_PER_HOUR = 60 * 60 * 1000
const CONFIDENCE_STEEPNESS = 0.4
const TAG_MULTIPLIERS = {
  Dairy: 1.5, 'High-Fat': 1.4, FODMAP: 1.35, Allium: 1.35, Fructans: 1.35,
  'High-Histamine': 1.3, 'processed meat': 1.25, Nightshade: 1.2, Soy: 1.2,
  Gluten: 1.2, 'wheat flour': 1.2, Nut: 1.15, soup: 1, Protein: 1,
  'high-sodium': 1, Salted: 1, 'Low-Risk': 0.5, Safe: 0.3,
} as const
const normalizedTagMultipliers = new Map(Object.entries(TAG_MULTIPLIERS).map(([tag, multiplier]) => [tag.toLowerCase(), multiplier] as const))

const parseTimestamp = (value: string) => {
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const round = (value: number) => Math.round(value * 1000) / 1000
const ingredientKey = (ingredient: IngredientRecord) => ingredient.id || ingredient.name.trim().toLowerCase()
const ingredientName = (ingredient: IngredientRecord) => ingredient.name.trim() || ingredient.id || 'Unknown ingredient'
const classify = (risk: number): StatsIngredientRow['classification'] => risk >= 0.7 ? 'high' : risk >= 0.3 ? 'neutral' : 'safe'
const tagMultiplier = (ingredient: IngredientRecord) => normalizeTags(ingredient.tags).reduce((highest, tag) => Math.max(highest, normalizedTagMultipliers.get(tag.toLowerCase()) ?? 1), 1)

const getWindow = (lagHours: number): { window: StatsWindow; weight: number } | null => {
  if (lagHours <= FAST_WINDOW_HOURS) return { window: 'fast', weight: 1 }
  if (lagHours <= MEDIUM_WINDOW_HOURS) return { window: 'medium', weight: 0.8 }
  if (lagHours <= LOOKBACK_HOURS) return { window: 'slow', weight: 0.4 }
  return null
}

type MealEntry = { log: FoodLogRecord; consumedAtMs: number; ingredients: IngredientRecord[] }
type EventCluster = { eventId: string; occurredAtMs: number; symptomLogs: SymptomLogRecord[] }

const mealEntries = (logs: FoodLogRecord[]): MealEntry[] => logs.map((log) => {
  const date = parseTimestamp(log.consumed_at)
  return date ? { log, consumedAtMs: date.getTime(), ingredients: extractIngredients(log) } : null
}).filter((entry): entry is MealEntry => entry !== null).sort((a, b) => a.consumedAtMs - b.consumedAtMs)

const clusters = (logs: SymptomLogRecord[], predicate: (type: number) => boolean) => {
  const events = logs.filter((log) => predicate(log.bristol_type)).map((log) => {
    const date = parseTimestamp(log.occurred_at)
    return date ? { log, occurredAtMs: date.getTime() } : null
  }).filter((event): event is { log: SymptomLogRecord; occurredAtMs: number } => event !== null).sort((a, b) => a.occurredAtMs - b.occurredAtMs)
  const grouped: EventCluster[] = []
  for (const event of events) {
    const previous = grouped[grouped.length - 1]
    if (previous && event.occurredAtMs - previous.occurredAtMs <= CLUSTER_WINDOW_HOURS * MS_PER_HOUR) previous.symptomLogs.push(event.log)
    else grouped.push({ eventId: event.log.id, occurredAtMs: event.occurredAtMs, symptomLogs: [event.log] })
  }
  return { events, grouped }
}

type IngredientStat = { ingredientId: string; ingredientName: string; symptomExposure: number; safeExposure: number; symptomObservationCount: number; safeObservationCount: number; tags: string[]; reactionLags: number[] }
const ensureStat = (stats: Map<string, IngredientStat>, ingredient: IngredientRecord) => {
  const id = ingredientKey(ingredient)
  const existing = stats.get(id)
  if (existing) return existing
  const created: IngredientStat = { ingredientId: id, ingredientName: ingredientName(ingredient), symptomExposure: 0, safeExposure: 0, symptomObservationCount: 0, safeObservationCount: 0, tags: normalizeTags(ingredient.tags), reactionLags: [] }
  stats.set(id, created)
  return created
}

export const calculateStatsTriggers = (foodLogs: FoodLogRecord[], symptomLogs: SymptomLogRecord[], ingredients: IngredientRecord[]): StatsAnalysis => {
  const acute = clusters(symptomLogs, (type) => type >= 6 && type <= 7)
  const control = clusters(symptomLogs, (type) => type >= 3 && type <= 5)
  const meals = mealEntries(foodLogs)
  const stats = new Map<string, IngredientStat>(ingredients.map((ingredient) => {
    const stat: IngredientStat = { ingredientId: ingredientKey(ingredient), ingredientName: ingredientName(ingredient), symptomExposure: 0, safeExposure: 0, symptomObservationCount: 0, safeObservationCount: 0, tags: normalizeTags(ingredient.tags), reactionLags: [] }
    return [stat.ingredientId, stat]
  }))
  const lagPoints: StatsLagPoint[] = []
  const acuteStarts = acute.grouped.map((cluster) => cluster.occurredAtMs)

  const processMeals = (cluster: EventCluster, isAcute: boolean) => {
    const start = cluster.occurredAtMs
    for (const meal of meals) {
      const lag = (start - meal.consumedAtMs) / MS_PER_HOUR
      if (lag <= 0 || lag > LOOKBACK_HOURS) continue
      const window = getWindow(lag)
      if (!window) continue
      if (!isAcute && acuteStarts.some((acuteStart) => meal.consumedAtMs < acuteStart && meal.consumedAtMs + LOOKBACK_HOURS * MS_PER_HOUR >= acuteStart)) continue
      const seen = new Set<string>()
      for (const ingredient of meal.ingredients) {
        const id = ingredientKey(ingredient)
        if (!id || seen.has(id)) continue
        seen.add(id)
        const stat = ensureStat(stats, { id, name: ingredientName(ingredient) })
        if (isAcute) {
          stat.symptomExposure += window.weight * tagMultiplier(ingredient)
          stat.symptomObservationCount += 1
          stat.reactionLags.push(lag)
          stat.tags = [...new Set([...stat.tags, ...normalizeTags(ingredient.tags)])]
        } else {
          stat.safeExposure += window.weight
          stat.safeObservationCount += 1
        }
      }
      if (isAcute) lagPoints.push({ eventId: cluster.eventId, eventOccurredAt: new Date(start).toISOString(), eventType: Math.max(...cluster.symptomLogs.map((log) => log.bristol_type)), mealId: meal.log.id, mealName: meal.log.meal_name || 'Meal', consumedAt: meal.log.consumed_at, lagHours: round(lag), window: window.window, windowWeight: window.weight, ingredientNames: [...new Set(meal.ingredients.map(ingredientName))] })
    }
  }
  acute.grouped.forEach((cluster) => processMeals(cluster, true))
  control.grouped.forEach((cluster) => processMeals(cluster, false))

  const ingredientRows = [...stats.values()].map((stat) => {
    const observationCount = stat.symptomObservationCount + stat.safeObservationCount
    const rawRisk = (stat.symptomExposure + 1) / (stat.symptomExposure + stat.safeExposure + 2)
    const confidenceMultiplier = 1 - Math.exp(-CONFIDENCE_STEEPNESS * observationCount)
    const risk = rawRisk * confidenceMultiplier
    return { ingredientId: stat.ingredientId, ingredientName: stat.ingredientName, symptomExposure: round(stat.symptomExposure), safeExposure: round(stat.safeExposure), rawRiskPercent: round(rawRisk * 100), confidenceMultiplier, riskPercent: round(risk * 100), symptomObservationCount: stat.symptomObservationCount, safeObservationCount: stat.safeObservationCount, observationCount, classification: classify(risk), tags: stat.tags, averageLagHours: stat.reactionLags.length ? round(stat.reactionLags.reduce((total, lag) => total + lag, 0) / stat.reactionLags.length) : null }
  }).sort((a, b) => b.riskPercent - a.riskPercent || b.symptomExposure - a.symptomExposure || a.ingredientName.localeCompare(b.ingredientName))
  lagPoints.sort((a, b) => a.lagHours - b.lagHours || a.consumedAt.localeCompare(b.consumedAt))
  return { acuteEventCount: acute.events.length, controlEventCount: control.events.length, ingredientRows, lagPoints }
}

export const classificationFill: Record<StatsIngredientRow['classification'], string> = { high: '#8f4b3f', neutral: '#b87d3b', safe: '#5d7e61' }
