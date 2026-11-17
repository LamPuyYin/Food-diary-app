import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareDesc, parseISO } from 'date-fns'
import { pb } from '../lib/pocketbase'
import {
  type FoodLogRecord,
  type IngredientRecord,
  type RecentActivityItem,
  type SymptomLogRecord,
  type TrackerStatsItem,
  extractIngredients,
} from '../lib/tracker'

type TrackerDataResult = {
  ingredients: IngredientRecord[]
  foodLogs: FoodLogRecord[]
  symptomLogs: SymptomLogRecord[]
  isLoading: boolean
  loadError: string | null
  stats: TrackerStatsItem[]
  recentActivity: RecentActivityItem[]
  reload: () => Promise<void>
  addIngredient: (ingredient: IngredientRecord) => void
}

export function useTrackerData(enabled = true): TrackerDataResult {
  const [ingredients, setIngredients] = useState<IngredientRecord[]>([])
  const [foodLogs, setFoodLogs] = useState<FoodLogRecord[]>([])
  const [symptomLogs, setSymptomLogs] = useState<SymptomLogRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) return

    setIsLoading(true)
    setLoadError(null)

    try {
      const [ingredientRows, foodRows, symptomRows] = await Promise.all([
        pb.collection('ingredients').getFullList(500, { sort: 'name' }),
        pb.collection('food_logs').getFullList(500, {
          sort: '-consumed_at',
          expand: 'ingredients,dishes,dishes.ingredients',
        }),
        pb.collection('symptom_logs').getFullList(500, { sort: '-occurred_at' }),
      ])

      setIngredients(
        ingredientRows.map((item) => ({
          id: item.id,
          name: String(item.name),
          tags: item.tags as IngredientRecord['tags'],
          createdBy: item.createdBy ? String(item.createdBy) : null,
          isArchived: Boolean(item.isArchived),
        })),
      )

      setFoodLogs(
        foodRows.map((item) => ({
          id: item.id,
          meal_name: String(item.meal_name ?? ''),
          consumed_at: String(item.consumed_at ?? ''),
          ingredients: Array.isArray(item.ingredients) ? (item.ingredients as string[]) : [],
          dishes: Array.isArray(item.dishes) ? (item.dishes as string[]) : [],
          expand: item.expand as FoodLogRecord['expand'],
        })),
      )

      setSymptomLogs(
        symptomRows.map((item) => ({
          id: item.id,
          occurred_at: String(item.occurred_at ?? ''),
          bristol_type: Number(item.bristol_type),
          notes: item.notes ? String(item.notes) : null,
        })),
      )
    } catch (error) {
      console.error(error)
      setLoadError('Unable to load PocketBase records.')
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void reload()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [reload])

  const stats = useMemo<TrackerStatsItem[]>(
    () => {
      const loggedDays = new Set(
        [...foodLogs.map((log) => log.consumed_at), ...symptomLogs.map((log) => log.occurred_at)]
          .map((timestamp) => parseISO(timestamp))
          .filter((date) => !Number.isNaN(date.getTime()))
          .map((date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`),
      ).size

      return [
        { label: 'Meals logged', value: foodLogs.length },
        { label: 'Bowel events', value: symptomLogs.length },
        { label: 'Ingredients', value: ingredients.length },
        { label: 'Days logged', value: loggedDays },
      ]
    },
    [foodLogs, symptomLogs, ingredients.length],
  )

  const recentActivity = useMemo(() => {
    const mealEvents: RecentActivityItem[] = foodLogs.map((log) => {
      const mealIngredients = extractIngredients(log)
      return {
        id: `meal-${log.id}`,
        kind: 'Meal',
        title: log.meal_name || 'Meal',
        at: log.consumed_at,
        details: mealIngredients.map((ingredient) => ingredient.name).join(', '),
        badge: `${mealIngredients.length} ingredients`,
      }
    })

    const symptomEvents: RecentActivityItem[] = symptomLogs.map((log) => ({
      id: `symptom-${log.id}`,
      kind: 'Bowel',
      title: `Type ${log.bristol_type}`,
      at: log.occurred_at,
      details: log.notes?.trim() || 'No notes',
      badge: 'Bristol scale',
    }))

    return [...mealEvents, ...symptomEvents]
      .sort((a, b) => compareDesc(parseISO(a.at), parseISO(b.at)))
      .slice(0, 8)
  }, [foodLogs, symptomLogs])

  const addIngredient = (ingredient: IngredientRecord) => {
    setIngredients((current) =>
      [...current, ingredient].sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  return {
    ingredients,
    foodLogs,
    symptomLogs,
    isLoading,
    loadError,
    stats,
    recentActivity,
    reload,
    addIngredient,
  }
}

