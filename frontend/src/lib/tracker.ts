import { format, parseISO } from 'date-fns'

export type AppRoute = '/' | '/stats' | '/ingredients' | '/meals' | '/bowel' | '/calendar'

export const PAGE_META: Record<
  AppRoute,
  { label: string; shortLabel: string; description: string }
> = {
  '/': {
    label: 'Home',
    shortLabel: 'Home',
    description: 'Your daily command center for logging, backup, and data quality.',
  },
  '/stats': {
    label: 'Food Analysis',
    shortLabel: 'Data quality',
    description: 'Check whether the diary has enough coverage to trust conclusions.',
  },
  '/ingredients': {
    label: 'Ingredients',
    shortLabel: 'Ingredient search',
    description: 'Search your ingredient library and review observed trigger patterns.',
  },
  '/meals': {
    label: 'Add Meals',
    shortLabel: 'Meals',
    description: 'Log, edit, and remove meals with their ingredient links.',
  },
  '/bowel': {
    label: 'Add Bowel Event',
    shortLabel: 'Bowel logs',
    description: 'Record, edit, and remove Bristol stool entries and notes.',
  },
  '/calendar': {
    label: 'Calendar',
    shortLabel: 'Calendar',
    description: 'Inspect all meal and symptom logs day by day.',
  },
}

export type IngredientRecord = {
  id: string
  name: string
  tags?: string[] | string | null
  createdBy?: string | null
  isArchived?: boolean
}

export type DishRecord = {
  id: string
  name: string
  date: string
  ingredients: string[]
  isArchived?: boolean
  expand?: {
    ingredients?: IngredientRecord[] | IngredientRecord
  }
}

export type FoodLogRecord = {
  id: string
  meal_name: string
  consumed_at: string
  ingredients?: string[]
  dishes?: string[]
  expand?: {
    ingredients?: IngredientRecord[] | IngredientRecord
    dishes?: DishRecord[] | DishRecord
  }
}

export type SymptomLogRecord = {
  id: string
  occurred_at: string
  bristol_type: number
  notes?: string | null
}

export type MealFormState = {
  mealCategory: string
  consumedAt: string
  selectedIngredientIds: string[]
}

export type SymptomFormState = {
  occurredAt: string
  bristolType: number
  notes: string
}

export type IngredientDraftState = {
  name: string
  tags: string
}

export type RecentActivityItem = {
  id: string
  kind: string
  title: string
  at: string
  details: string
  badge: string
}

export type TrackerStatsItem = {
  label: string
  value: number
}

export type DiaryConfidenceLevel = 'low' | 'building' | 'good' | 'strong'

export type DiaryConfidenceSignal = {
  label: string
  value: string
  tone: 'good' | 'warn' | 'neutral'
}

export type DiaryConfidenceSummary = {
  level: DiaryConfidenceLevel
  score: number
  title: string
  description: string
  nextStep: string
  signals: DiaryConfidenceSignal[]
}

export const isAppRoute = (pathname: string): pathname is AppRoute =>
  pathname === '/' ||
  pathname === '/stats' ||
  pathname === '/ingredients' ||
  pathname === '/meals' ||
  pathname === '/bowel' ||
  pathname === '/calendar'

export const formatDateTimeLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export const toIsoString = (value: string) => new Date(value).toISOString()

export const normalizeTags = (tags: IngredientRecord['tags']) => {
  if (!tags) return []
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean)
  }

  return String(tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export const extractIngredients = (foodLog: FoodLogRecord) => {
  const expanded = foodLog.expand?.ingredients
  if (!expanded) return []
  return Array.isArray(expanded) ? expanded : [expanded]
}

export const extractDishes = (foodLog: FoodLogRecord) => {
  const expanded = foodLog.expand?.dishes
  if (!expanded) return []
  return Array.isArray(expanded) ? expanded : [expanded]
}

export const getDiaryCoverageDays = (
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
) => {
  const timestamps = [
    ...foodLogs
      .map((log) => parseISO(log.consumed_at))
      .filter((date) => !Number.isNaN(date.getTime())),
    ...symptomLogs
      .map((log) => parseISO(log.occurred_at))
      .filter((date) => !Number.isNaN(date.getTime())),
  ]

  if (timestamps.length < 2) {
    return null
  }

  const earliest = Math.min(...timestamps.map((date) => date.getTime()))
  const latest = Math.max(...timestamps.map((date) => date.getTime()))
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  return (latest - earliest) / MS_PER_DAY
}

const getUniqueDiaryDayCount = (foodLogs: FoodLogRecord[], symptomLogs: SymptomLogRecord[]) => {
  const days = new Set<string>()

  for (const log of foodLogs) {
    const dayKey = formatDayKey(log.consumed_at)
    if (dayKey) {
      days.add(dayKey)
    }
  }

  for (const log of symptomLogs) {
    const dayKey = formatDayKey(log.occurred_at)
    if (dayKey) {
      days.add(dayKey)
    }
  }

  return days.size
}

export const buildDiaryConfidenceSummary = (
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
  ingredients: IngredientRecord[],
): DiaryConfidenceSummary => {
  const coverageDays = getDiaryCoverageDays(foodLogs, symptomLogs)
  const uniqueDays = getUniqueDiaryDayCount(foodLogs, symptomLogs)
  const mealCount = foodLogs.length
  const symptomCount = symptomLogs.length
  const ingredientCount = ingredients.length

  const coverageScore = Math.min(1, (coverageDays ?? 0) / 21)
  const dayScore = Math.min(1, uniqueDays / 14)
  const mealScore = Math.min(1, mealCount / 20)
  const symptomScore = Math.min(1, symptomCount / 8)
  const ingredientScore = Math.min(1, ingredientCount / 20)
  const balanceScore = mealCount > 0 ? Math.min(1, symptomCount / mealCount) : 0

  const score = Math.round(
    (coverageScore * 0.3 +
      dayScore * 0.2 +
      mealScore * 0.2 +
      symptomScore * 0.15 +
      ingredientScore * 0.1 +
      balanceScore * 0.05) *
      100,
  )

  let level: DiaryConfidenceLevel = 'low'
  let title = 'Not enough data yet'
  let description = 'The diary still needs more entries before trigger analysis is trustworthy.'
  let nextStep = 'Log a few more meals and bowel entries across different days.'

  if (score >= 80) {
    level = 'strong'
    title = 'Strong data coverage'
    description = 'Coverage looks healthy and the analysis has enough history to read trends.'
    nextStep = 'Keep logging steadily to preserve data quality.'
  } else if (score >= 60) {
    level = 'good'
    title = 'Good data coverage'
    description = 'You have a useful base, but a few more days of logs will sharpen the analysis.'
    nextStep = 'Add another week of consistent logging if you can.'
  } else if (score >= 35) {
    level = 'building'
    title = 'Low data coverage'
    description = 'There is enough data to explore, but the conclusions are still early.'
    nextStep = 'Keep meals and bowel logs aligned to the same dates.'
  }

  const signals: DiaryConfidenceSignal[] = [
    {
      label: 'Coverage',
      value: coverageDays === null ? 'n/a' : `${coverageDays.toFixed(1)} days`,
      tone: coverageDays === null || coverageDays < 7 ? 'warn' : 'good',
    },
    {
      label: 'Active days',
      value: `${uniqueDays} days`,
      tone: uniqueDays < 7 ? 'warn' : 'good',
    },
    {
      label: 'Meals logged',
      value: `${mealCount}`,
      tone: mealCount < 10 ? 'warn' : 'good',
    },
    {
      label: 'Bowel logs',
      value: `${symptomCount}`,
      tone: symptomCount < 4 ? 'warn' : 'good',
    },
  ]

  return { level, score, title, description, nextStep, signals }
}

export const formatDisplayTime = (value: string) => format(parseISO(value), 'MMM d, p')

export const formatDayKey = (value: string) => format(parseISO(value), 'yyyy-MM-dd')

export const emptyMealForm = (): MealFormState => ({
  mealCategory: '',
  consumedAt: formatDateTimeLocal(new Date()),
  selectedIngredientIds: [],
})

export const emptySymptomForm = (): SymptomFormState => ({
  occurredAt: formatDateTimeLocal(new Date()),
  bristolType: 4,
  notes: '',
})

export const emptyIngredientDraft = (): IngredientDraftState => ({
  name: '',
  tags: '',
})
