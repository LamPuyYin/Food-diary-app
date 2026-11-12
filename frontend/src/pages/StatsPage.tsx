import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  extractIngredients,
  getDiaryCoverageDays,
  normalizeTags,
  type FoodLogRecord,
  type IngredientRecord,
  type SymptomLogRecord,
} from '../lib/tracker'
import { calculateStatsTriggers, classificationFill } from './statsAnalysis'

type StatsPageProps = {
  ingredients: IngredientRecord[]
  foodLogs: FoodLogRecord[]
  symptomLogs: SymptomLogRecord[]
  loading: boolean
  onRefresh: () => void
}

type StatsWindow = 'fast' | 'medium' | 'slow'

type StatsLagPoint = {
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

type IngredientTooltipProps = {
  active?: boolean
  payload?: Array<{
    payload: StatsIngredientRow
  }>
}

type LagTooltipProps = {
  active?: boolean
  payload?: Array<{
    payload: StatsLagPoint
  }>
}

type IntakeTooltipProps = {
  active?: boolean
  label?: string
  payload?: Array<{ name?: string; value?: number; color?: string }>
}

type IntakeLegendProps = {
  payload?: Array<{ value?: string; color?: string }>
}

const ACUTE_MIN_TYPE = 6
const ACUTE_MAX_TYPE = 7
const CONTROL_MIN_TYPE = 3
const CONTROL_MAX_TYPE = 5
const LOOKBACK_HOURS = 48
const FAST_WINDOW_HOURS = 4
const MEDIUM_WINDOW_HOURS = 24
const CLUSTER_WINDOW_HOURS = 3
const MS_PER_HOUR = 60 * 60 * 1000
const CONFIDENCE_STEEPNESS = 0.4

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

type EventCluster = {
  eventId: string
  occurredAtMs: number
  symptomLogs: SymptomLogRecord[]
}

type StatsAnalysis = {
  acuteEventCount: number
  controlEventCount: number
  ingredientRows: StatsIngredientRow[]
  lagPoints: StatsLagPoint[]
}

const formatHours = (value: number) => `${value.toFixed(0)}h`
const formatPercent = (value: number) => `${value.toFixed(1)}%`

const parseTimestamp = (value: string) => {
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const roundToThreeDecimals = (value: number) => Math.round(value * 1000) / 1000

const classifyRri = (rri: number): 'high' | 'neutral' | 'safe' => {
  if (rri >= 0.7) return 'high'
  if (rri >= 0.3) return 'neutral'
  return 'safe'
}

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
  const rows = new Map<
    string,
    {
      ingredientId: string
      ingredientName: string
      symptomExposure: number
      safeExposure: number
      symptomObservationCount: number
      safeObservationCount: number
      tags: string[]
      reactionLags: number[]
    }
  >()

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
        symptomObservationCount: 0,
        safeObservationCount: 0,
        tags: normalizeTags(ingredient.tags),
        reactionLags: [],
      })
    }
  }

  return rows
}

const ensureIngredientStat = (
  stats: Map<
    string,
    {
      ingredientId: string
      ingredientName: string
      symptomExposure: number
      safeExposure: number
      symptomObservationCount: number
      safeObservationCount: number
      tags: string[]
      reactionLags: number[]
    }
  >,
  ingredient: IngredientRecord,
) => {
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
    symptomObservationCount: 0,
    safeObservationCount: 0,
    tags: normalizeTags(ingredient.tags),
    reactionLags: [],
  }

  stats.set(ingredientId, created)
  return created
}

const getWindowForLag = (lagHours: number): { window: StatsWindow; weight: number } | null => {
  if (lagHours <= FAST_WINDOW_HOURS) {
    return { window: 'fast', weight: 1 }
  }

  if (lagHours <= MEDIUM_WINDOW_HOURS) {
    return { window: 'medium', weight: 0.8 }
  }

  if (lagHours <= LOOKBACK_HOURS) {
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

const clusterSymptomLogs = (
  symptomLogs: SymptomLogRecord[],
  predicate: (type: number) => boolean,
) => {
  const events = symptomLogs
    .filter((log) => predicate(log.bristol_type))
    .map((log) => {
      const occurredAt = parseTimestamp(log.occurred_at)
      return occurredAt ? { log, occurredAtMs: occurredAt.getTime() } : null
    })
    .filter((entry): entry is ParsedSymptomLog => entry !== null)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs)

  const clusters: EventCluster[] = []
  const clusterWindowMs = CLUSTER_WINDOW_HOURS * MS_PER_HOUR

  for (const event of events) {
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

  return { events, clusters }
}

// Kept temporarily as an implementation reference while the shared analysis module is adopted.
const calculateStatsTriggersLegacy = (
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
  ingredients: IngredientRecord[],
): StatsAnalysis => {
  const severe = clusterSymptomLogs(
    symptomLogs,
    (type) => type >= ACUTE_MIN_TYPE && type <= ACUTE_MAX_TYPE,
  )
  const control = clusterSymptomLogs(
    symptomLogs,
    (type) => type >= CONTROL_MIN_TYPE && type <= CONTROL_MAX_TYPE,
  )
  const mealEntries = buildMealEntries(foodLogs)
  const ingredientStats = buildIngredientIndex(ingredients)
  const lagPoints: StatsLagPoint[] = []

  const severeClusterStarts = severe.clusters.map((cluster) => cluster.occurredAtMs).sort((a, b) => a - b)

  for (const cluster of severe.clusters) {
    const clusterStart = cluster.occurredAtMs
    const lookbackStart = clusterStart - LOOKBACK_HOURS * MS_PER_HOUR
    const eventType = Math.max(...cluster.symptomLogs.map((log) => log.bristol_type))

    for (const mealEntry of mealEntries) {
      if (mealEntry.consumedAtMs >= clusterStart || mealEntry.consumedAtMs < lookbackStart) {
        continue
      }

      const lagHours = (clusterStart - mealEntry.consumedAtMs) / MS_PER_HOUR
      const windowInfo = getWindowForLag(lagHours)
      if (!windowInfo) {
        continue
      }

      const ingredientNames = [
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
        eventType,
        mealId: mealEntry.log.id,
        mealName: mealEntry.log.meal_name || 'Meal',
        consumedAt: mealEntry.log.consumed_at,
        lagHours: roundToThreeDecimals(lagHours),
        window: windowInfo.window,
        windowWeight: windowInfo.weight,
        ingredientNames,
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
        stat.symptomObservationCount += 1
        stat.reactionLags.push(lagHours)
        stat.tags = [...new Set([...stat.tags, ...normalizeTags(ingredient.tags)])]
      }
    }
  }

  for (const cluster of control.clusters) {
    const clusterStart = cluster.occurredAtMs
    const lookbackStart = clusterStart - LOOKBACK_HOURS * MS_PER_HOUR

    for (const mealEntry of mealEntries) {
      if (mealEntry.consumedAtMs >= clusterStart || mealEntry.consumedAtMs < lookbackStart) {
        continue
      }

      const isWithinSevereWindow = severeClusterStarts.some(
        (severeStart) =>
          mealEntry.consumedAtMs < severeStart &&
          mealEntry.consumedAtMs + LOOKBACK_HOURS * MS_PER_HOUR >= severeStart,
      )

      if (isWithinSevereWindow) {
        continue
      }

      const lagHours = (clusterStart - mealEntry.consumedAtMs) / MS_PER_HOUR
      const windowInfo = getWindowForLag(lagHours)
      if (!windowInfo) {
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

        stat.safeExposure += windowInfo.weight
        stat.safeObservationCount += 1
      }
    }
  }

  const ingredientRows = [...ingredientStats.values()]
    .map((stat) => {
      const rawRisk = (stat.symptomExposure + 1) / (stat.symptomExposure + stat.safeExposure + 2)
      const observationCount = stat.symptomObservationCount + stat.safeObservationCount
      const confidenceMultiplier = 1 - Math.exp(-CONFIDENCE_STEEPNESS * observationCount)
      const adjustedRri = applyConfidenceCurve(rawRisk, observationCount)

      return {
        ingredientId: stat.ingredientId,
        ingredientName: stat.ingredientName,
        symptomExposure: roundToThreeDecimals(stat.symptomExposure),
        safeExposure: roundToThreeDecimals(stat.safeExposure),
        rawRiskPercent: roundToThreeDecimals(rawRisk * 100),
        confidenceMultiplier,
        riskPercent: roundToThreeDecimals(adjustedRri * 100),
        symptomObservationCount: stat.symptomObservationCount,
        safeObservationCount: stat.safeObservationCount,
        observationCount,
        classification: classifyRri(adjustedRri),
        tags: stat.tags,
        averageLagHours:
          stat.reactionLags.length > 0
            ? roundToThreeDecimals(
                stat.reactionLags.reduce((total, lag) => total + lag, 0) / stat.reactionLags.length,
              )
            : null,
      }
    })
    .sort(
      (a, b) =>
        b.riskPercent - a.riskPercent ||
        b.symptomExposure - a.symptomExposure ||
        a.ingredientName.localeCompare(b.ingredientName),
    )

  lagPoints.sort((a, b) => a.lagHours - b.lagHours || a.consumedAt.localeCompare(b.consumedAt))

  return {
    acuteEventCount: severe.events.length,
    controlEventCount: control.events.length,
    ingredientRows,
    lagPoints,
  }
}

const getMonthKey = (value: string) => {
  const date = parseTimestamp(value)
  return date ? format(date, 'yyyy-MM') : null
}

void calculateStatsTriggersLegacy

const formatMonthLabel = (monthKey: string) => format(parseISO(`${monthKey}-01`), 'MMM yy')
const formatDayLabel = (dayKey: string) => format(parseISO(`${dayKey}T00:00:00`), 'MMM d')

type MonthlySeverityRow = {
  month: string
  label: string
  averageScore: number
  eventCount: number
  typeCounts: Record<number, number>
}

const buildSeverityRows = (symptomLogs: SymptomLogRecord[], period: 'month' | 'day'): MonthlySeverityRow[] => {
  const months = new Map<string, { month: string; totalScore: number; eventCount: number; typeCounts: Record<number, number> }>()

  for (const log of symptomLogs) {
    const date = parseTimestamp(log.occurred_at)
    if (!date || log.bristol_type < 1 || log.bristol_type > 7) continue
    const key = period === 'month' ? format(date, 'yyyy-MM') : format(date, 'yyyy-MM-dd')
    const row = months.get(key) ?? { month: key, totalScore: 0, eventCount: 0, typeCounts: {} }
    row.totalScore += log.bristol_type
    row.eventCount += 1
    row.typeCounts[log.bristol_type] = (row.typeCounts[log.bristol_type] ?? 0) + 1
    months.set(key, row)
  }

  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      month: row.month,
      label: period === 'month' ? formatMonthLabel(row.month) : formatDayLabel(row.month),
      averageScore: roundToThreeDecimals(row.totalScore / row.eventCount),
      eventCount: row.eventCount,
      typeCounts: row.typeCounts,
    }))
}

const severityColor = (score: number) => score <= 3 ? '#b87d3b' : score <= 5 ? '#5d7e61' : '#a6534a'

const SeverityDot = (props: { cx?: number; cy?: number; payload?: MonthlySeverityRow }) => {
  if (props.cx === undefined || props.cy === undefined || !props.payload) return null
  return <circle cx={props.cx} cy={props.cy} r={5} fill={severityColor(props.payload.averageScore)} stroke="#fff" strokeWidth={2} />
}

export const EvidenceBar = ({ label, detail, width, color }: { label: string; detail: string; width: number; color: string }) => (
  <div className="evidence-bar">
    <div className="evidence-bar__label"><span>{label}</span><strong>{detail}</strong></div>
    <div className="evidence-bar__track"><div className="evidence-bar__fill" style={{ width: `${Math.min(100, Math.max(4, width))}%`, background: color }} /></div>
  </div>
)

const IntakeValidationTooltip = ({ active, label, payload }: IntakeTooltipProps) => {
  if (!active || !payload?.length) return null
  const ordered = [...payload].sort((left, right) => (left.name === 'Diarrhea events' ? -1 : right.name === 'Diarrhea events' ? 1 : 0))
  return (
    <div className="chart-tooltip">
      <strong className="chart-tooltip__title">{label}</strong>
      {ordered.map((entry) => <span key={entry.name} style={{ color: entry.name === 'Diarrhea events' ? '#a6534a' : entry.color }}>{entry.name}: {entry.value}</span>)}
    </div>
  )
}

const IntakeValidationLegend = ({ payload }: IntakeLegendProps) => {
  const ordered = [...(payload ?? [])].sort((left, right) => (left.value === 'Diarrhea events' ? -1 : right.value === 'Diarrhea events' ? 1 : 0))
  return <div className="chart-legend">{ordered.map((entry) => <span key={entry.value} className={entry.value === 'Diarrhea events' ? 'chart-legend__priority' : undefined}><i style={{ background: entry.color }} />{entry.value}</span>)}</div>
}

const MonthlySeverityTooltip = ({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: MonthlySeverityRow }>
}) => {
  if (!active || !payload?.length) return null

  const row = payload[0].payload
  return (
    <div className="chart-tooltip">
      <strong>{row.label}</strong>
      <span>Average Bristol score: {row.averageScore.toFixed(2)}</span>
      <span>{row.eventCount} bowel events</span>
      {Array.from({ length: 7 }, (_, index) => index + 1)
        .filter((type) => (row.typeCounts[type] ?? 0) > 0)
        .map((type) => {
          const color = type <= 3 ? '#b87d3b' : type <= 5 ? '#5d7e61' : '#a6534a'
          return (
            <span key={type} style={{ color }}>
              Type {type}: {row.typeCounts[type]} ({((row.typeCounts[type] / row.eventCount) * 100).toFixed(1)}%)
            </span>
          )
        })}
    </div>
  )
}

const buildHourlyLagRows = (lagPoints: StatsLagPoint[]) =>
  Array.from({ length: LOOKBACK_HOURS }, (_, hour) => ({
    hour,
    label: `${hour}h`,
    events: lagPoints.filter((point) => Math.min(47, Math.floor(point.lagHours)) === hour).length,
  }))

const buildMonthlyFoodVsEventRows = (
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
  topIngredients: StatsIngredientRow[],
) => {
  const series = topIngredients.map((ingredient, index) => ({
    key: `trigger${index + 1}`,
    name: ingredient.ingredientName,
    ingredientId: ingredient.ingredientId,
  }))
  const months = new Map<string, Record<string, string | number>>()
  const getRow = (month: string) => {
    const existing = months.get(month)
    if (existing) return existing
    const row: Record<string, string | number> = { month, label: formatMonthLabel(month), diarrhea: 0 }
    for (const entry of series) row[entry.key] = 0
    months.set(month, row)
    return row
  }

  for (const log of symptomLogs) {
    const month = getMonthKey(log.occurred_at)
    if (month && log.bristol_type >= 6 && log.bristol_type <= 7) {
      const row = getRow(month)
      row.diarrhea = Number(row.diarrhea) + 1
    }
  }

  for (const log of foodLogs) {
    const month = getMonthKey(log.consumed_at)
    if (!month) continue
    const selectedIds = new Set(extractIngredients(log).map(getIngredientKey))
    const row = getRow(month)
    for (const entry of series) {
      if (selectedIds.has(entry.ingredientId)) row[entry.key] = Number(row[entry.key]) + 1
    }
  }

  return {
    series,
    rows: [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))),
  }
}

const IngredientTooltip = ({ active, payload }: IngredientTooltipProps) => {
  if (!active || !payload?.length) {
    return null
  }

  const row = payload[0].payload

  return (
    <div className="chart-tooltip">
      <strong className="chart-tooltip__title">{row.ingredientName}</strong>
      <span>{row.symptomObservationCount} acute windows</span>
      <span>{row.safeObservationCount} safe-control windows</span>
      <span>{row.symptomExposure.toFixed(2)} symptom exposure</span>
      <span>{row.safeExposure.toFixed(2)} safe baseline exposure</span>
      <span>Risk: {formatPercent(row.riskPercent)}</span>
      <span>Raw risk: {formatPercent(row.rawRiskPercent)}</span>
      <span>Confidence: {row.confidenceMultiplier.toFixed(2)}x</span>
      <span>
        {row.observationCount < 5 ? 'Needs more entries to confirm' : 'Confidence stable'}
      </span>
    </div>
  )
}

const LagTooltip = ({ active, payload }: LagTooltipProps) => {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="chart-tooltip">
      <strong className="chart-tooltip__title">{point.mealName}</strong>
      <span>Window: {windowLabel[point.window]}</span>
      <span>Lag: {point.lagHours.toFixed(1)} hours</span>
      <span>
        Meal: {format(parseISO(point.consumedAt), 'MMM d, p')} to symptom{' '}
        {format(parseISO(point.eventOccurredAt), 'MMM d, p')}
      </span>
      <span>Type {point.eventType}</span>
      {point.ingredientNames.length ? <span>{point.ingredientNames.join(', ')}</span> : null}
    </div>
  )
}

const median = (values: number[]) => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const windowLabel: Record<StatsWindow, string> = {
  fast: '0-4h',
  medium: '4-24h',
  slow: '24-48h',
}

const windowFill: Record<StatsWindow, string> = {
  fast: '#5d7e61',
  medium: '#b87d3b',
  slow: '#7a5a3e',
}

const classificationFillLegacy: Record<StatsIngredientRow['classification'], string> = {
  high: '#8f4b3f',
  neutral: '#b87d3b',
  safe: '#5d7e61',
}

void classificationFillLegacy 

export function StatsPage({
  ingredients,
  foodLogs,
  symptomLogs,
  loading,
  onRefresh,
}: StatsPageProps) {
  const analysis = useMemo(
    () => calculateStatsTriggers(foodLogs, symptomLogs, ingredients),
    [foodLogs, symptomLogs, ingredients],
  )

  const diaryCoverageDays = useMemo(
    () => getDiaryCoverageDays(foodLogs, symptomLogs),
    [foodLogs, symptomLogs],
  )

  const medianLagHours = useMemo(
    () => median(analysis.lagPoints.map((point) => point.lagHours)),
    [analysis.lagPoints],
  )

  const riskRows = analysis.ingredientRows.slice(0, 8)
  const riskChartRows = riskRows.map((row) => ({
    ...row,
    candidatePercent: row.rawRiskPercent,
  }))
  const candidateRows = [...analysis.ingredientRows]
    .sort(
      (a, b) =>
        b.rawRiskPercent - a.rawRiskPercent ||
        b.symptomExposure - a.symptomExposure ||
        a.ingredientName.localeCompare(b.ingredientName),
    )
    .slice(0, 8)
    .map((row) => ({ ...row, candidatePercent: row.rawRiskPercent }))
  const lowestRiskRows = [...analysis.ingredientRows]
    .filter((row) => row.observationCount >= 5)
    .sort((a, b) => a.riskPercent - b.riskPercent || a.observationCount - b.observationCount || a.ingredientName.localeCompare(b.ingredientName))
    .slice(0, 8)
  const topIngredient = analysis.ingredientRows[0]
  const isLowDataDiary = diaryCoverageDays !== null && diaryCoverageDays < 14
  const topIngredientNeedsMoreData = (topIngredient?.observationCount ?? 0) < 5
  const [ingredientRiskView, setIngredientRiskView] = useState<'relative' | 'candidates' | 'lowest'>('relative')

  const fastPoints = analysis.lagPoints.filter((point) => point.window === 'fast')
  const mediumPoints = analysis.lagPoints.filter((point) => point.window === 'medium')
  const slowPoints = analysis.lagPoints.filter((point) => point.window === 'slow')

  const highProbabilityCount = analysis.ingredientRows.filter((row) => row.classification === 'high')
    .length
  const neutralCount = analysis.ingredientRows.filter((row) => row.classification === 'neutral')
    .length
  const safeCount = analysis.ingredientRows.filter((row) => row.classification === 'safe').length
  const [severityView, setSeverityView] = useState<'monthly' | 'daily'>('monthly')
  const [dailyRange, setDailyRange] = useState(14)
  const monthlySeverityRows = useMemo(() => buildSeverityRows(symptomLogs, 'month'), [symptomLogs])
  const dailySeverityRows = useMemo(() => buildSeverityRows(symptomLogs, 'day'), [symptomLogs])
  const severityRows = severityView === 'monthly' ? monthlySeverityRows : dailySeverityRows.slice(-dailyRange)
  const hourlyLagRows = useMemo(() => buildHourlyLagRows(analysis.lagPoints), [analysis.lagPoints])
  const deepDiveRows = useMemo(() => analysis.ingredientRows.slice(0, 5), [analysis.ingredientRows])
  const monthlyFoodVsEvent = useMemo(
    () => buildMonthlyFoodVsEventRows(foodLogs, symptomLogs, deepDiveRows),
    [foodLogs, symptomLogs, deepDiveRows],
  )
  return (
    <div className="page-stack dashboard-page">
      <section className="hero-card dashboard-hero">
        <div className="hero-copy">
          <header className="logger-header dashboard-page-header">
            <div>
              <h2>IBS food trigger analysis</h2>
            </div>
          </header>
          <p>
            Analyse correlations between food and bowel events, help monitor your food trigger.
          </p>

          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={onRefresh}>
              {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Refresh data
            </button>
          </div>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <span>Acute bowel events</span>
            <strong>{analysis.acuteEventCount}</strong>
          </div>
          <div className="stat">
            <span>Normal bowel events</span>
            <strong>{analysis.controlEventCount}</strong>
          </div>
          <div className="stat">
            <span>Median time of bowel event</span>
            <strong>{medianLagHours === null ? 'n/a' : `${medianLagHours.toFixed(1)}h`}</strong>
          </div>
        </div>
      </section>

      {isLowDataDiary ? (
        <div className="alert">
          <AlertTriangle size={16} />
          Low data: only {diaryCoverageDays?.toFixed(1)} days of logging so far. Keep collecting
          14 to 21 days of consistent food and bowel entries to stabilize the baseline.
        </div>
      ) : null}

      <section className="analysis-summary-grid">
        <article className="analysis-summary">
          <span className="sidebar-kicker">Ingredients saved</span>
          <strong>{ingredients.length}</strong>
          <p>See Ingredients page for individual statistics</p>
        </article>
        <article className="analysis-summary">
          <span className="sidebar-kicker">Highest probability</span>
          <strong>{topIngredient?.ingredientName ?? 'No trigger yet'}</strong>
          <p>
            {topIngredient
              ? topIngredientNeedsMoreData
                ? `Needs more entries to confirm. ${topIngredient.observationCount} observations and ${Math.round(topIngredient.riskPercent)}% risk.`
                : `${topIngredient.observationCount} observations and ${Math.round(topIngredient.riskPercent)}% risk.`
              : 'Add more food and bowel logs to surface trigger candidates.'}
          </p>
        </article>
        
        
        <article className="analysis-summary">
          <span className="sidebar-kicker">Low-risk Ingredients</span>
          <strong>
            {neutralCount} neutral / {safeCount} safe
          </strong>
          <p>Ingredients with risk score below 0.70.</p>
        </article>
        <article className="analysis-summary">
          <span className="sidebar-kicker">High-risk Ingredients</span>
          <strong>{highProbabilityCount} strong risk</strong>
          <p>Ingredients that are likely IBS triggers.</p>
        </article>
      </section>

      <section className="analysis-grid">
        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>{severityView === 'monthly' ? 'Monthly' : 'Daily'} stool severity trend</h3>
              <span className="badge">{severityRows.length} {severityView === 'monthly' ? 'months' : 'days'}</span>
            </div>
            <div className="analysis-card__actions">
              <label className="sr-only" htmlFor="severity-view">Severity graph period</label>
              <select id="severity-view" value={severityView} onChange={(event) => setSeverityView(event.target.value as typeof severityView)}>
                <option value="monthly">Monthly severity</option>
                <option value="daily">Daily severity</option>
              </select>
              {severityView === 'daily' ? (
                <>
                  <label className="sr-only" htmlFor="daily-severity-range">Daily severity date range</label>
                  <select id="daily-severity-range" value={dailyRange} onChange={(event) => setDailyRange(Number(event.target.value))}>
                    <option value={7}>Last 7 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={48}>Last 48 days</option>
                  </select>
                </>
              ) : null}
            </div>
          </div>

          {loading ? <div className="empty-state">Loading logs...</div> : severityRows.length === 0 ? (
            <div className="empty-state">Add bowel logs to see monthly normal, constipation, and diarrhea patterns.</div>
          ) : (
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={severityRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" padding={{ left: 24, right: 24 }} />
                  <YAxis domain={[1, 7]} tickCount={7} label={{ value: 'Average Bristol score', angle: -90, position: 'left' }} />
                  <ReferenceArea y1={1} y2={3.99} fill="#b87d3b" fillOpacity={0.08} />
                  <ReferenceArea y1={4} y2={4.99} fill="#5d7e61" fillOpacity={0.08} />
                  <ReferenceArea y1={5} y2={7} fill="#a6534a" fillOpacity={0.08} />
                  <Tooltip content={<MonthlySeverityTooltip />} />
                  <Line type="monotone" dataKey="averageScore" name="Average Bristol score" stroke="#6e7652" strokeWidth={3} dot={<SeverityDot />} activeDot={{ r: 7 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>{ingredientRiskView === 'candidates' ? 'Top acute event triggering ingredients' : ingredientRiskView === 'lowest' ? 'Lowest relative risk ingredients' : 'Highest relative risk ingredients'}</h3>

            </div>
            <div className="analysis-card__actions">
              <label className="sr-only" htmlFor="ingredient-risk-view">Ingredient risk view</label>
              <select id="ingredient-risk-view" value={ingredientRiskView} onChange={(event) => setIngredientRiskView(event.target.value as typeof ingredientRiskView)}>
                <option value="relative">Highest risk food</option>
                <option value="candidates">Top candidate triggers</option>
                <option value="lowest">Lowest risk food</option>
              </select>
            </div>
          </div>

          {loading ? (
              <div className="empty-state">Loading logs...</div>
            ) : (ingredientRiskView === 'candidates' ? candidateRows : ingredientRiskView === 'lowest' ? lowestRiskRows : riskRows).length === 0 ? (
              <div className="empty-state">
                No severe-event lookback matches yet. Add more meal and bowel entries to build
                the trigger list.
              </div>
            ) : (
              <div className="chart-frame chart-frame--bar">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={ingredientRiskView === 'candidates' ? candidateRows : ingredientRiskView === 'lowest' ? lowestRiskRows : riskChartRows}
                    layout="vertical"
                    margin={{ top: 8, right: 20, left: 8, bottom: 8 }}
                    barCategoryGap="26%"
                  >
                    <CartesianGrid strokeDasharray="4 4" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="ingredientName"
                      width={150}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<IngredientTooltip />} cursor={{ fill: 'rgba(82, 119, 86, 0.08)' }} />
                    <Legend />
                    {ingredientRiskView === 'candidates' ? (
                      <Bar dataKey="candidatePercent" name="Top candidate trigger" fill="#c18c5d" radius={[0, 10, 10, 0]}>
                        {candidateRows.map((entry) => (
                          <Cell key={entry.ingredientId} fill={classificationFill[entry.classification]} />
                        ))}
                        <LabelList dataKey="candidatePercent" position="right" fill="#1f281f" />
                      </Bar>
                    ) : (
                      <Bar dataKey="riskPercent" name="Relative risk index" radius={[0, 10, 10, 0]}>
                      {(ingredientRiskView === 'lowest' ? lowestRiskRows : riskChartRows).map((entry) => (
                        <Cell
                          key={entry.ingredientId}
                          fill={ingredientRiskView === 'lowest' ? '#4f8a63' : classificationFill[entry.classification]}
                        />
                      ))}
                      <LabelList dataKey="riskPercent" position="right" fill="#1f281f" />
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          <p className="analysis-disclaimer">
              <strong>Relative risk</strong> compares an ingredient risk in causing acute event base on FODMAP scores and trigger frequencies. 
              <strong>Top acute event triggers</strong> checks how often was this food causing an acute event. 
              <br/>Neither score proves that a food caused symptoms, they are clues that become more useful as you add consistent entries.
            </p>
        </article>

        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>Top suspect foods deep-dive</h3>
            </div>
          </div>

          {loading ? <div className="empty-state">Loading logs...</div> : deepDiveRows.length === 0 ? (
            <div className="empty-state">Suspect cards appear after meals are linked to diarrhea events.</div>
          ) : (
            <div className="suspect-grid">
              {deepDiveRows.map((ingredient) => (
                <article key={ingredient.ingredientId} className="suspect-card">
                  <div className="suspect-card__topline">
                    <strong>{ingredient.ingredientName}</strong>
                    <span>{formatPercent(ingredient.riskPercent)} risk</span>
                  </div>
                  <div className="candidate-row__meter" aria-label={`${ingredient.ingredientName} risk score`}>
                    <div className="candidate-row__fill" style={{ width: `${Math.max(4, ingredient.riskPercent)}%`, background: classificationFill[ingredient.classification] }} />
                  </div>
                  <div className="suspect-evidence">
                    <EvidenceBar
                      label="Confidence"
                      detail={`${ingredient.observationCount} logs`}
                      width={ingredient.confidenceMultiplier * 100}
                      color="#5d7e61"
                    />
                    <EvidenceBar
                      label="Diarrhea vs safe days"
                      detail={`${ingredient.symptomObservationCount}x vs ${ingredient.safeObservationCount}x`}
                      width={ingredient.symptomObservationCount + ingredient.safeObservationCount > 0 ? (ingredient.symptomObservationCount / (ingredient.symptomObservationCount + ingredient.safeObservationCount)) * 100 : 4}
                      color="#a6534a"
                    />
                    <EvidenceBar
                      label="Average bowel reaction time"
                      detail={ingredient.averageLagHours === null ? 'n/a' : `${ingredient.averageLagHours.toFixed(1)}h`}
                      width={ingredient.averageLagHours === null ? 4 : (ingredient.averageLagHours / LOOKBACK_HOURS) * 100}
                      color="#b87d3b"
                    />
                  </div>
                  {ingredient.tags.length > 0 ? (
                    <div className="suspect-tags">
                      {ingredient.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : <span className="suspect-no-tags">No clinical tags yet</span>}
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>Meal to acute symptom timeline</h3>
              <span className="badge">{analysis.lagPoints.length} logs</span>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading logs...</div>
          ) : analysis.lagPoints.length === 0 ? (
            <div className="empty-state">
              No 48 hour meal-symptom pairs were found for acute diarrhea events.
            </div>
          ) : (
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    dataKey="lagHours"
                    domain={[0, 48]}
                    tickFormatter={formatHours}
                    label={{ value: 'Hours from meal to event start', position: 'bottom', offset: 0 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="eventType"
                    domain={[5.5, 7.5]}
                    ticks={[6, 7]}
                    tickFormatter={(value) => `Type ${value}`}
                    label={{ value: 'Bristol type', angle: -90, position: 'left' }}
                  />
                  <ReferenceArea x1={0} x2={4} fill="rgba(93, 126, 97, 0.08)" />
                  <ReferenceArea x1={4} x2={24} fill="rgba(184, 125, 59, 0.08)" />
                  <ReferenceArea x1={24} x2={48} fill="rgba(122, 90, 62, 0.08)" />
                  <ReferenceLine x={4} stroke="#5d7e61" strokeDasharray="5 5" />
                  <ReferenceLine x={24} stroke="#b87d3b" strokeDasharray="5 5" />
                  <ReferenceLine x={48} stroke="#7a5a3e" strokeDasharray="5 5" />
                  <Tooltip content={<LagTooltip />} cursor={{ strokeDasharray: '4 4' }} />
                  <Scatter data={fastPoints} fill={windowFill.fast} />
                  <Scatter data={mediumPoints} fill={windowFill.medium} />
                  <Scatter data={slowPoints} fill={windowFill.slow} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>Acute reaction time after consumption, hour by hour</h3>
              <span className="badge">0–48 hours</span>
            </div>
            <div className="chart-tooltip ">
            
              <div>60% of IBS patients report symptoms after meals, 
              specifically with 28% reacting within 15 minutes 
              and 93% reacting within 3 hours</div>
            
            </div>
          </div>
          

          {loading ? <div className="empty-state">Loading logs...</div> : analysis.lagPoints.length === 0 ? (
            <div className="empty-state">No meal-to-diarrhea pairs exist yet for the 48-hour reaction distribution.</div>
          ) : (
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyLagRows} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}h`} interval={3} label={{ value: 'Hours after food intake', position: 'bottom', offset: 4 }} />
                  <YAxis allowDecimals={false} label={{ value: 'Diarrhea links', angle: -90, position: 'left' }} />
                  <Tooltip labelFormatter={(hour) => `${hour}–${Number(hour) + 1} hours after food`} />
                  <Bar dataKey="events" name="Diarrhea links" fill="#b87d3b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="analysis-card analysis-card--wide">
          <div className="analysis-card__header">
            <div>
              <h3>Monthly top trigger-food intake versus acute symptom</h3>
              <span className="badge">Top {monthlyFoodVsEvent.series.length} foods</span>
            </div>
          </div>

          {loading ? <div className="empty-state">Loading logs...</div> : monthlyFoodVsEvent.rows.length === 0 ? (
            <div className="empty-state">Log meals and bowel events across months to compare intake with flare-ups.</div>
          ) : (
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyFoodVsEvent.rows} margin={{ top: 8, right: 16, left: 24, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="events" allowDecimals={false} label={{ value: 'Diarrhea events', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="intake" orientation="right" allowDecimals={false} label={{ value: 'Food logs', angle: 90, position: 'right' }} />
                  <Tooltip content={<IntakeValidationTooltip />} />
                  <Legend content={<IntakeValidationLegend />} />
                  <Line yAxisId="events" type="monotone" dataKey="diarrhea" name="Diarrhea events" stroke="#a6534a" strokeWidth={3} dot={{ r: 4 }} />
                  {monthlyFoodVsEvent.series.map((series, index) => (
                    <Bar key={series.key} yAxisId="intake" dataKey={series.key} name={series.name} stackId="intake" fill={['#5d7e61', '#7e9e82', '#c18c5d', '#9e6d4c', '#7a5a3e'][index]} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>


        
      </section>
    </div>
  )
}





