import { parseISO } from 'date-fns'
import { extractIngredients, type FoodLogRecord, type IngredientRecord, type SymptomLogRecord } from './tracker'

const HOURS_24 = 24
const HOURS_72 = 72
const MS_PER_HOUR = 60 * 60 * 1000
const CONFIDENCE_STEEPNESS = 0.5

type ParsedFoodLog = {
  log: FoodLogRecord
  consumedAtMs: number
}

type ParsedSymptomLog = {
  log: SymptomLogRecord
  occurredAtMs: number
}

export type TriggerIngredientRow = {
  ingredientId: string
  ingredientName: string
  frequency: number
  severeEventCoverage: number
  rawRiskPercent: number
  confidenceMultiplier: number
  riskPercent: number
}

export type TriggerLagPoint = {
  symptomId: string
  symptomOccurredAt: string
  symptomType: number
  mealId: string
  mealName: string
  consumedAt: string
  lagHours: number
  ingredientNames: string[]
}

export type TriggerAnalysis = {
  severeEventCount: number
  triggerIngredients: TriggerIngredientRow[]
  timeLagPoints: TriggerLagPoint[]
}

const parseTimestamp = (value: string) => {
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const roundToOneDecimal = (value: number) => Math.round(value * 10) / 10

const applyConfidenceCurve = (rawRisk: number, observations: number) =>
  rawRisk * (1 - Math.exp(-CONFIDENCE_STEEPNESS * observations))

const getIngredientKey = (ingredient: IngredientRecord) =>
  ingredient.id || ingredient.name.trim().toLowerCase()

const getIngredientName = (ingredient: IngredientRecord) =>
  ingredient.name.trim() || ingredient.id || 'Unknown ingredient'

export function calculateTriggers(
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
): TriggerAnalysis {
  const severeEvents = symptomLogs
    .filter((log) => log.bristol_type <= 2 || log.bristol_type >= 6)
    .map((log) => {
      const occurredAt = parseTimestamp(log.occurred_at)
      return occurredAt ? { log, occurredAtMs: occurredAt.getTime() } : null
    })
    .filter((entry): entry is ParsedSymptomLog => entry !== null)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs)

  const mealTimeline: ParsedFoodLog[] = foodLogs
    .map((log) => {
      const consumedAt = parseTimestamp(log.consumed_at)
      return consumedAt
        ? {
            log,
            consumedAtMs: consumedAt.getTime(),
          }
        : null
    })
    .filter((entry): entry is ParsedFoodLog => entry !== null)

  const ingredientStats = new Map<
    string,
    {
      ingredientId: string
      ingredientName: string
      frequency: number
      severeEventIds: Set<string>
    }
  >()
  const timeLagPoints: TriggerLagPoint[] = []

  for (const event of severeEvents) {
    const lookbackLower = event.occurredAtMs - HOURS_72 * MS_PER_HOUR
    const lookbackUpper = event.occurredAtMs - HOURS_24 * MS_PER_HOUR

    for (const mealEntry of mealTimeline) {
      if (mealEntry.consumedAtMs < lookbackLower || mealEntry.consumedAtMs > lookbackUpper) {
        continue
      }

      const lagHours = roundToOneDecimal((event.occurredAtMs - mealEntry.consumedAtMs) / MS_PER_HOUR)
      const mealIngredients = extractIngredients(mealEntry.log)
      const ingredientNames = [
        ...new Map(
          mealIngredients
            .map((ingredient) => ({
              id: getIngredientKey(ingredient),
              name: getIngredientName(ingredient),
            }))
            .filter((ingredient) => ingredient.id && ingredient.name)
            .map((ingredient) => [ingredient.id, ingredient.name] as const),
        ).values(),
      ]

      timeLagPoints.push({
        symptomId: event.log.id,
        symptomOccurredAt: event.log.occurred_at,
        symptomType: event.log.bristol_type,
        mealId: mealEntry.log.id,
        mealName: mealEntry.log.meal_name || 'Meal',
        consumedAt: mealEntry.log.consumed_at,
        lagHours,
        ingredientNames,
      })

      const seenIngredientIds = new Set<string>()
      for (const ingredient of mealIngredients) {
        const ingredientId = getIngredientKey(ingredient)
        const ingredientName = getIngredientName(ingredient)
        if (!ingredientId || seenIngredientIds.has(ingredientId)) {
          continue
        }

        seenIngredientIds.add(ingredientId)

        const stat = ingredientStats.get(ingredientId) ?? {
          ingredientId,
          ingredientName,
          frequency: 0,
          severeEventIds: new Set<string>(),
        }

        stat.frequency += 1
        stat.severeEventIds.add(event.log.id)
        ingredientStats.set(ingredientId, stat)
      }
    }
  }

  const triggerIngredients = [...ingredientStats.values()]
    .map(({ severeEventIds, ...stat }) => ({
      ...stat,
      severeEventCoverage: severeEvents.length ? severeEventIds.size : 0,
    }))
    .map((stat) => {
      const rawRiskPercent = severeEvents.length
        ? roundToOneDecimal((stat.severeEventCoverage / severeEvents.length) * 100)
        : 0
      const confidenceMultiplier = 1 - Math.exp(-CONFIDENCE_STEEPNESS * stat.frequency)

      return {
        ...stat,
        rawRiskPercent,
        confidenceMultiplier,
        riskPercent: roundToOneDecimal(applyConfidenceCurve(rawRiskPercent, stat.frequency)),
      }
    })
    .sort(
      (a, b) =>
        b.frequency - a.frequency ||
        b.severeEventCoverage - a.severeEventCoverage ||
        a.ingredientName.localeCompare(b.ingredientName),
    )

  timeLagPoints.sort((a, b) => a.lagHours - b.lagHours || a.consumedAt.localeCompare(b.consumedAt))

  return {
    severeEventCount: severeEvents.length,
    triggerIngredients,
    timeLagPoints,
  }
}
