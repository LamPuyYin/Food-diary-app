import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Archive, ChevronDown, Clock3, Loader2, Pencil, Plus, RotateCcw, Save, Undo2, UtensilsCrossed, X } from 'lucide-react'
import { parseISO } from 'date-fns'
import { pb } from '../lib/pocketbase'
import {
  emptyIngredientDraft,
  emptyMealForm,
  extractDishes,
  extractIngredients,
  formatDateTimeLocal,
  normalizeTags,
  toIsoString,
  type IngredientDraftState,
  type FoodLogRecord,
  type IngredientRecord,
  type MealFormState,
} from '../lib/tracker'
import { mapOpenFoodFactsProductToTags } from '../utils/tagAutoMapper'
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal'
import { IngredientEditModal } from '../components/IngredientEditModal'
import { MealLogger } from '../components/MealLogger'
import { RecentMealsPopup } from '../components/RecentMealsPopup'
import { getOpenFoodFactsSearchUrl } from '../platform'

type MealLoggerPageProps = {
  ingredients: IngredientRecord[]
  foodLogs: FoodLogRecord[]
  loadingIngredients: boolean
  onIngredientCreated: (ingredient: IngredientRecord) => void
  onSaved: () => void
}

type OpenFoodFactsProduct = {
  code?: string
  product_name?: string
  generic_name?: string
  categories?: string
  categories_tags?: string[]
  ingredients_text?: string
  ingredients_text_en?: string
  brands?: string
  quantity?: string
}

type ExternalIngredientSuggestion = {
  id: string
  name: string
  tags: string[]
  details: string
}

type MealLogStep = 'category' | 'timestamp' | 'ingredients'

type MealEditNavigationState = {
  editMealId?: string
  editMeal?: FoodLogRecord
}

const OPEN_FOOD_FACTS_SEARCH_URL = getOpenFoodFactsSearchUrl()
const MIN_EXTERNAL_SEARCH_LENGTH = 3
const EXTERNAL_FALLBACK_THRESHOLD = 5
const EXTERNAL_SEARCH_DEBOUNCE_MS = 750
const MEAL_CATEGORY_STORAGE_KEY = 'food-diary.custom-meal-categories'
const COMMON_MEAL_CATEGORIES = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snacks',
  'Drinks',
  'Brunch',
  'Dessert',
  'Late-night snack',
  'Second breakfast',
  'Supper',
  'Appetizer',
  'Other',
] as const

const normalizeSearchValue = (value: string) => value.trim().toLowerCase()
const normalizeTagValue = (value: string) => value.trim().toLowerCase()
const normalizeMealCategoryValue = (value: string) => value.trim().toLowerCase()

const getIngredientSearchText = (ingredient: IngredientRecord) =>
  `${ingredient.name} ${normalizeTags(ingredient.tags).join(' ')}`.toLowerCase().trim()

const isFodmapLibraryIngredient = (ingredient: IngredientRecord) =>
  ingredient.createdBy === 'fodmapLibrary'

const buildProductName = (product: OpenFoodFactsProduct) =>
  product.product_name?.trim() || product.generic_name?.trim() || product.brands?.trim() || ''

const buildProductDetails = (product: OpenFoodFactsProduct) =>
  [product.brands?.trim(), product.categories?.trim(), product.quantity?.trim()]
    .filter(Boolean)
    .join(' / ')

const getTagDraftParts = (value: string) => {
  const parts = value.split(',')
  const currentPart = parts.pop() ?? ''

  return { parts, currentPart }
}

const readStoredMealCategories = () => {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  try {
    const rawValue = window.localStorage.getItem(MEAL_CATEGORY_STORAGE_KEY)
    if (!rawValue) {
      return []
    }

    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    const seen = new Set<string>()
    return parsed
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .filter((value) => {
        const normalized = normalizeMealCategoryValue(value)
        if (seen.has(normalized)) {
          return false
        }

        seen.add(normalized)
        return true
      })
  } catch {
    return []
  }
}

export function MealLoggerPage({
  ingredients,
  foodLogs,
  loadingIngredients,
  onIngredientCreated,
  onSaved,
}: MealLoggerPageProps) {
  const [mealForm, setMealForm] = useState<MealFormState>(() => emptyMealForm())
  const [dishIngredientIds, setDishIngredientIds] = useState<string[]>([])
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([])
  const [customMealCategoryDraft, setCustomMealCategoryDraft] = useState('')
  const [savedMealCategories, setSavedMealCategories] = useState<string[]>(() =>
    readStoredMealCategories(),
  )
  const [ingredientDraft, setIngredientDraft] = useState<IngredientDraftState>(
    () => emptyIngredientDraft(),
  )
  const [showIngredientDraft, setShowIngredientDraft] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [externalSuggestions, setExternalSuggestions] = useState<ExternalIngredientSuggestion[]>(
    [],
  )
  const [searchingExternal, setSearchingExternal] = useState(false)
  const [externalSearchError, setExternalSearchError] = useState<string | null>(null)
  const [savingMeal, setSavingMeal] = useState(false)
  const [savingIngredient, setSavingIngredient] = useState(false)
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null)
  const [showMealHistory, setShowMealHistory] = useState(false)
  const showMealHistorySection = false
  const [showUserIngredients, setShowUserIngredients] = useState(true)
  const [showFodmapIngredients, setShowFodmapIngredients] = useState(true)
  const [showArchivedIngredients, setShowArchivedIngredients] = useState(false)
  const [visibleIngredientCounts, setVisibleIngredientCounts] = useState({
    searchKey: '',
    user: 30,
    fodmap: 30,
  })
  const [message, setMessage] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<MealLogStep>('category')
  const [timestampConfirmed, setTimestampConfirmed] = useState(false)
  const [pendingIngredientDeletion, setPendingIngredientDeletion] = useState<IngredientRecord | null>(null)
  const [pendingMealDeletion, setPendingMealDeletion] = useState<FoodLogRecord | null>(null)
  const handledEditLocationKey = useRef<string | null>(null)
  const location = useLocation()

  // Keep the accordion navigation tied to the values that are actually
  // required to log a meal. `timestampConfirmed` is only a UI checkpoint and
  // can otherwise become stale when the user edits an earlier step.
  const canOpenIngredients = Boolean(mealForm.mealCategory.trim() && mealForm.consumedAt)

  const activeIngredientIds = useMemo(
    () => Array.from(new Set([...mealForm.selectedIngredientIds, ...dishIngredientIds])),
    [dishIngredientIds, mealForm.selectedIngredientIds],
  )

  const searchKey = normalizeSearchValue(searchTerm)
  const savedMealCategoryLookup = useMemo(
    () => new Set(COMMON_MEAL_CATEGORIES.map((category) => normalizeMealCategoryValue(category))),
    [],
  )
  const customMealCategories = useMemo(() => {
    const seen = new Set<string>()

    return savedMealCategories.filter((category) => {
      const normalized = normalizeMealCategoryValue(category)
      if (!normalized || savedMealCategoryLookup.has(normalized) || seen.has(normalized)) {
        return false
      }

      seen.add(normalized)
      return true
    })
  }, [savedMealCategories, savedMealCategoryLookup])
  const tagSuggestions = useMemo(() => {
    const { currentPart } = getTagDraftParts(ingredientDraft.tags)
    const query = normalizeTagValue(currentPart)

    if (query.length === 0) {
      return []
    }

    const existingTags = new Set(
      normalizeTags(ingredientDraft.tags).map((tag) => normalizeTagValue(tag)),
    )
    const seenTags = new Set<string>()

    return ingredients
      .flatMap((ingredient) => normalizeTags(ingredient.tags))
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .filter((tag) => normalizeTagValue(tag).includes(query))
      .filter((tag) => {
        const normalized = normalizeTagValue(tag)
        if (existingTags.has(normalized) || seenTags.has(normalized)) {
          return false
        }
        seenTags.add(normalized)
        return true
      })
      .slice(0, 6)
  }, [ingredientDraft.tags, ingredients])

  const filteredIngredients = useMemo(() => {
    const visibleIngredients = showArchivedIngredients
      ? ingredients
      : ingredients.filter((ingredient) => !ingredient.isArchived)
    if (!searchKey) {
      return visibleIngredients
    }

    return visibleIngredients.filter((ingredient) =>
      getIngredientSearchText(ingredient).includes(searchKey),
    )
  }, [ingredients, searchKey, showArchivedIngredients])

  const ingredientGroups = useMemo(
    () => ({
      user: filteredIngredients.filter((ingredient) => !isFodmapLibraryIngredient(ingredient)),
      fodmap: filteredIngredients.filter(isFodmapLibraryIngredient),
    }),
    [filteredIngredients],
  )

  const currentVisibleIngredientCounts = visibleIngredientCounts.searchKey === searchKey
    ? visibleIngredientCounts
    : { searchKey, user: 30, fodmap: 30 }

  const loadMoreIngredients = (group: 'user' | 'fodmap', total: number) => {
    setVisibleIngredientCounts((current) => ({
      ...current,
      searchKey,
      [group]: Math.min(
        (current.searchKey === searchKey ? current[group] : 30) + 30,
        total,
      ),
    }))
  }

  const mostFrequentIngredients = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>()

    for (const foodLog of foodLogs) {
      const seenInMeal = new Set<string>()
      for (const ingredient of extractIngredients(foodLog)) {
        const id = ingredient.id?.trim()
        const name = ingredient.name?.trim()
        if (!id || !name || seenInMeal.has(id)) {
          continue
        }

        seenInMeal.add(id)
        const current = counts.get(id)
        if (current) {
          current.count += 1
        } else {
          counts.set(id, { id, name, count: 1 })
        }
      }
    }

    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6)
  }, [foodLogs])

  const ingredientUsageCounts = useMemo(() => {
    const counts = new Map<string, number>()

    for (const foodLog of foodLogs) {
      const seenInMeal = new Set<string>()
      for (const ingredient of extractIngredients(foodLog)) {
        if (seenInMeal.has(ingredient.id)) {
          continue
        }

        seenInMeal.add(ingredient.id)
        counts.set(ingredient.id, (counts.get(ingredient.id) ?? 0) + 1)
      }
    }

    return counts
  }, [foodLogs])

  useEffect(() => {
    try {
      window.localStorage.setItem(MEAL_CATEGORY_STORAGE_KEY, JSON.stringify(customMealCategories))
    } catch (error) {
      console.warn(error)
    }
  }, [customMealCategories])

  useEffect(() => {
    const skipExternalSearch =
      loadingIngredients ||
      searchKey.length < MIN_EXTERNAL_SEARCH_LENGTH ||
      filteredIngredients.length >= EXTERNAL_FALLBACK_THRESHOLD

    if (skipExternalSearch) {
      const resetTimeoutId = window.setTimeout(() => {
        setExternalSuggestions([])
        setSearchingExternal(false)
        setExternalSearchError(null)
      }, 0)

      return () => window.clearTimeout(resetTimeoutId)
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setSearchingExternal(true)
      setExternalSearchError(null)

      try {
        const response = await fetch(
          `${OPEN_FOOD_FACTS_SEARCH_URL}${encodeURIComponent(searchTerm.trim())}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,generic_name,brands,categories,ingredients_text,ingredients_text_en,categories_tags,ingredients_tags`,
          { signal: controller.signal },
        )

        if (response.status === 503) {
          setExternalSuggestions([])
          return
        }

        if (!response.ok) {
          throw new Error(`Open Food Facts search failed with status ${response.status}`)
        }

        const data = (await response.json()) as { products?: OpenFoodFactsProduct[] }
        if (controller.signal.aborted) {
          return
        }

        const seenIds = new Set<string>()
        const suggestions = (Array.isArray(data.products) ? data.products : [])
          .map((product) => {
            const name = buildProductName(product)
            if (!name) {
              return null
            }

            const id = product.code?.trim() || name.toLowerCase()
            if (seenIds.has(id)) {
              return null
            }

            seenIds.add(id)

            return {
              id,
              name,
              tags: mapOpenFoodFactsProductToTags(product),
              details: buildProductDetails(product),
            } satisfies ExternalIngredientSuggestion
          })
          .filter((suggestion): suggestion is ExternalIngredientSuggestion => suggestion !== null)

        setExternalSuggestions(suggestions)
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(error)
          setExternalSuggestions([])
          setExternalSearchError('Open Food Facts lookup is temporarily unavailable.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchingExternal(false)
        }
      }
    }, EXTERNAL_SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [filteredIngredients.length, loadingIngredients, searchKey, searchTerm])

  const toggleIngredient = (id: string) => {
    setMealForm((current) => ({
      ...current,
      selectedIngredientIds: current.selectedIngredientIds.includes(id)
        ? current.selectedIngredientIds.filter((ingredientId) => ingredientId !== id)
        : [...current.selectedIngredientIds, id],
    }))
    if (!mealForm.selectedIngredientIds.includes(id)) {
      setActiveStep('ingredients')
    }
  }

  const selectMealCategory = (category: string) => {
    setMealForm((current) => ({
      ...current,
      mealCategory: category,
    }))
    setTimestampConfirmed(false)
  }

  const saveCustomMealCategory = () => {
    const nextCategory = customMealCategoryDraft.trim().replace(/\s+/g, ' ')

    if (!nextCategory) {
      setMessage('Custom meal category is required.')
      return
    }

    const normalizedNextCategory = normalizeMealCategoryValue(nextCategory)
    const commonCategory = COMMON_MEAL_CATEGORIES.find(
      (category) => normalizeMealCategoryValue(category) === normalizedNextCategory,
    )

    if (commonCategory) {
      selectMealCategory(commonCategory)
      setCustomMealCategoryDraft('')
      setMessage(`"${commonCategory}" is already one of the built-in categories.`)
      return
    }

    const existingCustomCategory = customMealCategories.find(
      (category) => normalizeMealCategoryValue(category) === normalizedNextCategory,
    )

    if (existingCustomCategory) {
      selectMealCategory(existingCustomCategory)
      setCustomMealCategoryDraft('')
      setMessage(`"${existingCustomCategory}" is already saved for later use.`)
      return
    }

    setSavedMealCategories((current) => [...current, nextCategory])
    selectMealCategory(nextCategory)
    setCustomMealCategoryDraft('')
    setMessage(`Saved "${nextCategory}" for later meals.`)
  }

  const selectIngredient = (id: string) => {
    setMealForm((current) => ({
      ...current,
      selectedIngredientIds: Array.from(new Set([...current.selectedIngredientIds, id])),
    }))
    setActiveStep('ingredients')
  }

  const appendTagSuggestion = (tag: string) => {
    setIngredientDraft((current) => {
      const { parts } = getTagDraftParts(current.tags)
      const cleanedParts = parts.map((part) => part.trim()).filter(Boolean)

      return {
        ...current,
        tags: [...cleanedParts, tag].join(', '),
      }
    })
  }

  const resetIngredientDraft = () => {
    setIngredientDraft(emptyIngredientDraft())
    setEditingIngredientId(null)
    setShowIngredientDraft(false)
  }

  const loadIngredientForEdit = (ingredient: IngredientRecord) => {
    setEditingIngredientId(ingredient.id)
    setIngredientDraft({
      name: ingredient.name,
      tags: normalizeTags(ingredient.tags).join(', '),
    })
    setShowIngredientDraft(false)
    setMessage(`Editing "${ingredient.name}".`)
  }

  const createIngredient = async () => {
    const name = ingredientDraft.name.trim()
    if (!name) {
      setMessage('Ingredient name is required.')
      return
    }

    const exists = ingredients.some((ingredient) => {
      if (editingIngredientId && ingredient.id === editingIngredientId) {
        return false
      }

      return ingredient.name.toLowerCase() === name.toLowerCase()
    })
    if (exists) {
      setMessage('That ingredient already exists in the list.')
      return
    }

    setSavingIngredient(true)
    setMessage(null)

    try {
      const tags = ingredientDraft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)

      const payload = {
        name,
        tags,
      }

      if (editingIngredientId) {
        const updated = await pb.collection('ingredients').update(editingIngredientId, payload)
        const nextIngredient: IngredientRecord = {
          id: updated.id,
          name: String(updated.name),
          tags: updated.tags as IngredientRecord['tags'],
        }

        onSaved()
        selectIngredient(nextIngredient.id)
        setMessage(`Updated "${name}".`)
      } else {
        const created = await pb.collection('ingredients').create({
          ...payload,
          createdBy: 'user',
        })
        const nextIngredient: IngredientRecord = {
          id: created.id,
          name: String(created.name),
          tags: created.tags as IngredientRecord['tags'],
        }

        onIngredientCreated(nextIngredient)
        selectIngredient(nextIngredient.id)
        setMessage(`Created "${name}" and added it to the meal.`)
      }

      resetIngredientDraft()
    } catch (error) {
      console.error(error)
      setMessage('Could not save the ingredient.')
    } finally {
      setSavingIngredient(false)
    }
  }

  const archiveIngredient = async (ingredient: IngredientRecord) => {
    try {
      const isArchived = !ingredient.isArchived
      await pb.collection('ingredients').update(ingredient.id, { isArchived })
      setMessage(`${isArchived ? 'Archived' : 'Restored'} "${ingredient.name}".`)
      setPendingIngredientDeletion(null)
      onSaved()
    } catch (error) {
      console.error(error)
      setMessage(`Could not ${ingredient.isArchived ? 'restore' : 'archive'} the ingredient.`)
    }
  }

  const saveEditedIngredient = async (ingredient: IngredientRecord, name: string, tags: string[]) => {
    const exists = ingredients.some((item) => item.id !== ingredient.id && item.name.toLowerCase() === name.toLowerCase())
    if (exists) throw new Error('That ingredient already exists in the list.')
    await pb.collection('ingredients').update(ingredient.id, { name, tags })
    setEditingIngredientId(null)
    setMessage(`Updated "${name}".`)
    await onSaved()
  }

  const importExternalSuggestion = async (suggestion: ExternalIngredientSuggestion) => {
    const existing = ingredients.find(
      (ingredient) => ingredient.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase(),
    )

    if (existing) {
      selectIngredient(existing.id)
      setMessage(`Used existing ingredient "${existing.name}" from the local cache.`)
      return
    }

    setSavingIngredient(true)
    setMessage(null)

    try {
      const created = await pb.collection('ingredients').create({
        name: suggestion.name,
        tags: suggestion.tags,
        createdBy: 'user',
      })

      const nextIngredient: IngredientRecord = {
        id: created.id,
        name: String(created.name),
        tags: created.tags as IngredientRecord['tags'],
      }

      onIngredientCreated(nextIngredient)
      selectIngredient(nextIngredient.id)
      setMessage(`Imported "${suggestion.name}" from Open Food Facts and added it to the meal.`)
    } catch (error) {
      console.error(error)
      setMessage('Could not import the Open Food Facts suggestion.')
    } finally {
      setSavingIngredient(false)
    }
  }

  const submitMeal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!mealForm.mealCategory.trim()) {
      setMessage('Meal category is required.')
      return
    }

    if (activeIngredientIds.length === 0) {
      setMessage('Select at least one ingredient before saving the meal.')
      return
    }

    setSavingMeal(true)
    setMessage(null)

    try {
      const payload = {
        meal_name: mealForm.mealCategory.trim(),
        consumed_at: toIsoString(mealForm.consumedAt),
        ingredients: activeIngredientIds,
        dishes: selectedDishIds,
      }

      console.info('[MealLogger] submitting food_logs record', {
        operation: editingMealId ? 'update' : 'create',
        recordId: editingMealId ?? null,
        payload,
        formState: mealForm,
      })

      if (editingMealId) {
        await pb.collection('food_logs').update(editingMealId, payload)
        setMessage('Meal updated.')
      } else {
        await pb.collection('food_logs').create(payload)
        setMessage('Meal saved.')
      }

      console.info('[MealLogger] food_logs request succeeded', {
        operation: editingMealId ? 'update' : 'create',
        recordId: editingMealId ?? null,
      })

      setMealForm(emptyMealForm())
      setDishIngredientIds([])
      setSelectedDishIds([])
      setEditingMealId(null)
      setActiveStep('category')
      setTimestampConfirmed(false)
      onSaved()
    } catch (error) {
      const clientError = error as {
        status?: number
        url?: string
        message?: string
        response?: unknown
      }

      console.error('[MealLogger] food_logs request failed', {
        operation: editingMealId ? 'update' : 'create',
        recordId: editingMealId ?? null,
        payload: {
          meal_name: mealForm.mealCategory.trim(),
          consumed_at: toIsoString(mealForm.consumedAt),
          ingredients: activeIngredientIds,
          dishes: selectedDishIds,
        },
        status: clientError.status,
        url: clientError.url,
        message: clientError.message,
        response: clientError.response,
        error,
      })
      setMessage('Could not save the meal.')
    } finally {
      setSavingMeal(false)
    }
  }

  const loadMealForEdit = (foodLog: FoodLogRecord) => {
    console.info('[MealLoggerPage] loading meal for edit', {
      id: foodLog.id,
      foodLog,
    })
    const ingredientIds = extractIngredients(foodLog).map((ingredient) => ingredient.id)
    const loggedDishes = extractDishes(foodLog)
    const loggedDishIngredientIds = Array.from(
      new Set(
        loggedDishes.flatMap((dish) =>
          Array.isArray(dish.ingredients) ? dish.ingredients : [],
        ),
      ),
    )
    const manualIngredientIds = ingredientIds.filter((id) => !loggedDishIngredientIds.includes(id))

    setEditingMealId(foodLog.id)
    setDishIngredientIds(loggedDishIngredientIds)
    setSelectedDishIds(loggedDishes.map((dish) => dish.id))
    setMealForm({
      mealCategory: foodLog.meal_name,
      consumedAt: formatDateTimeLocal(parseISO(foodLog.consumed_at)),
      selectedIngredientIds: manualIngredientIds,
    })
    setActiveStep('ingredients')
    setTimestampConfirmed(true)
    setMessage(`Editing "${foodLog.meal_name || 'Meal'}".`)
  }

  const deleteMeal = async (foodLog: FoodLogRecord) => {
    try {
      await pb.collection('food_logs').delete(foodLog.id)
      if (editingMealId === foodLog.id) {
        setMealForm(emptyMealForm())
        setDishIngredientIds([])
        setSelectedDishIds([])
        setEditingMealId(null)
      }
      setMessage('Meal deleted.')
      setPendingMealDeletion(null)
      onSaved()
    } catch (error) {
      console.error(error)
      setMessage('Could not delete the meal.')
    }
  }

  const cancelMealEdit = () => {
    setEditingMealId(null)
    setMealForm(emptyMealForm())
    setDishIngredientIds([])
    setSelectedDishIds([])
    setActiveStep('category')
    setTimestampConfirmed(false)
    setMessage('Meal edit cancelled.')
  }

  const clearIngredientSelections = () => {
    setMealForm((current) => ({ ...current, selectedIngredientIds: [] }))
    setDishIngredientIds([])
    setSelectedDishIds([])
  }

  const resetIngredients = () => {
    clearIngredientSelections()
    setMessage('All ingredient selections cleared.')
  }

  const cancelIngredientEdit = () => {
    resetIngredientDraft()
    setMessage('Ingredient edit cancelled.')
  }

  useEffect(() => {
    const editState = location.state as MealEditNavigationState | null
    const editMealId = editState?.editMealId
    // Calendar already has the full log it is displaying. Prefer that record so
    // navigation does not fall back to a blank form while foodLogs is refreshing.
    const foodLog = editState?.editMeal ?? (editMealId
      ? foodLogs.find((log) => log.id === editMealId)
      : undefined)
    console.info('[MealLoggerPage] edit navigation received', {
      locationState: location.state,
      editMealId,
      sharedFoodLogCount: foodLogs.length,
      matchedFoodLog: foodLog,
    })
    if (!foodLog || handledEditLocationKey.current === location.key) return

    // Do not clear location.state with a second navigation here. Replacing the
    // route can remount this form and reset the just-loaded edit state. The ref
    // makes the current navigation idempotent while preserving the form.
    handledEditLocationKey.current = location.key
    loadMealForEdit(foodLog)
  }, [foodLogs, location.key, location.state])

  return (
    <article className="logger-card page-card">
      <header className="logger-header">
        <div>
          <div className="section-label">
            <UtensilsCrossed size={16} />
            Food logger
          </div>
        </div>
        <button
          type="button"
          className="ghost-button ghost-button--compact"
          onClick={() => setShowMealHistory(true)}
        >
          <Clock3 size={16} /> Recent meals
        </button>
      </header>

      {showMealHistory ? (
        <RecentMealsPopup
          foodLogs={foodLogs}
          onClose={() => setShowMealHistory(false)}
          onEdit={(foodLog) => {
            loadMealForEdit(foodLog)
            setShowMealHistory(false)
          }}
          onDelete={(foodLog) => setPendingMealDeletion(foodLog)}
        />
      ) : null}
      {editingIngredientId ? (() => {
        const ingredient = ingredients.find((item) => item.id === editingIngredientId)
        return ingredient ? (
          <IngredientEditModal
            ingredient={ingredient}
            onClose={() => setEditingIngredientId(null)}
            onSaved={(name, tags) => saveEditedIngredient(ingredient, name, tags)}
            onDelete={() => setPendingIngredientDeletion(ingredient)}
          />
        ) : null
      })() : null}
      {pendingIngredientDeletion ? (
        <ConfirmDeleteModal
          title={pendingIngredientDeletion.isArchived ? 'Restore ingredient?' : 'Archive ingredient?'}
          message={
            (ingredientUsageCounts.get(pendingIngredientDeletion.id) ?? 0) > 0
              ? `“${pendingIngredientDeletion.name}” is used in ${ingredientUsageCounts.get(pendingIngredientDeletion.id)} logged meal(s), this will be achieved instead.`
              : `This will permanently remove “${pendingIngredientDeletion.name}”.`
          }
          onCancel={() => setPendingIngredientDeletion(null)}
          onConfirm={() => archiveIngredient(pendingIngredientDeletion)}
        />
      ) : null}
      {pendingMealDeletion ? <ConfirmDeleteModal title="Delete meal log?" message={`This will permanently remove “${pendingMealDeletion.meal_name || 'Meal'}” from your diary.`} onCancel={() => setPendingMealDeletion(null)} onConfirm={() => deleteMeal(pendingMealDeletion)} /> : null}

      <form className="logger-form" onSubmit={submitMeal}>
        <section className={`meal-log-step ${activeStep === 'category' ? 'is-open' : ''}`}>
          <button
            type="button"
            className="meal-log-step__heading"
            onClick={() => {
              setTimestampConfirmed(false)
              setActiveStep('category')
            }}
            aria-expanded={activeStep === 'category'}
          >
            <span className="meal-log-step__number">1</span>
            <span>
              <strong>Meal category</strong>
              <small>{activeStep !== 'category' && mealForm.mealCategory ? mealForm.mealCategory : 'Choose what kind of meal this was.'}</small>
            </span>
            <ChevronDown size={18} className={`collapse-icon ${activeStep === 'category' ? 'open' : ''}`} />
          </button>
          <div className={`meal-log-step__content field meal-category-field ${activeStep === 'category' ? 'is-visible' : ''}`} aria-hidden={activeStep !== 'category'}>
          <span>Meal category</span>
          <p className="field-help">
            Pick a common category or save a custom one you use often.
          </p>
          <div className="meal-category-picker" role="group" aria-label="Meal categories">
            <div className="meal-category-group">
              <span className="field-title">Popular categories</span>
              <div className="meal-category-chip-list">
                {COMMON_MEAL_CATEGORIES.map((category) => {
                  const selected = mealForm.mealCategory === category

                  return (
                    <button
                      key={category}
                      type="button"
                      className={`meal-category-chip ${selected ? 'selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => selectMealCategory(category)}
                    >
                      <span>{category}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {customMealCategories.length > 0 ? (
              <div className="meal-category-group">
                <span className="field-title">Saved custom categories</span>
                <div className="meal-category-chip-list">
                  {customMealCategories.map((category) => {
                    const selected = mealForm.mealCategory === category

                    return (
                      <button
                        key={category}
                        type="button"
                        className={`meal-category-chip meal-category-chip--custom ${
                          selected ? 'selected' : ''
                        }`}
                        aria-pressed={selected}
                        onClick={() => selectMealCategory(category)}
                      >
                        <span>{category}</span>
                        <small>Saved locally</small>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="meal-category-group meal-category-group--custom">
              <span className="field-title">Create a custom category</span>
              <div className="custom-category-row">
                <label className="field">
                  <input
                    aria-label="Custom meal category"
                    value={customMealCategoryDraft}
                    onChange={(event) => setCustomMealCategoryDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        saveCustomMealCategory()
                      }
                    }}
                    placeholder="e.g. pre-workout, midnight meal"
                  />
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={saveCustomMealCategory}
                >
                  <Plus size={16} />
                  Save category
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setTimestampConfirmed(false)
              setActiveStep('timestamp')
            }}
            disabled={!mealForm.mealCategory.trim()}
          >
            Continue
          </button>
          </div>
        </section>

        <section className={`meal-log-step ${activeStep === 'timestamp' ? 'is-open' : ''}`}>
          <button
            type="button"
            className="meal-log-step__heading"
            onClick={() => mealForm.mealCategory && setActiveStep('timestamp')}
            aria-expanded={activeStep === 'timestamp'}
            disabled={!mealForm.mealCategory}
          >
            <span className="meal-log-step__number">2</span>
            <span>
              <strong>Intake time</strong>
              <small>{activeStep !== 'timestamp' && timestampConfirmed ? mealForm.consumedAt.replace('T', ' at ') : mealForm.mealCategory ? 'Confirm when you ate it.' : 'Choose a meal category first.'}</small>
            </span>
            <ChevronDown size={18} className={`collapse-icon ${activeStep === 'timestamp' ? 'open' : ''}`} />
          </button>
          <label className={`meal-log-step__content field ${activeStep === 'timestamp' ? 'is-visible' : ''}`} aria-hidden={activeStep !== 'timestamp'}>
          <span className="sr-only">Intake time</span>
          <div className="input-with-icon">
            <Clock3 size={16} />
            <input
              type="datetime-local"
              value={mealForm.consumedAt}
              onChange={(event) =>
                {
                  setMealForm((current) => ({ ...current, consumedAt: event.target.value }))
                }
              }
            />
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setTimestampConfirmed(true)
              setActiveStep('ingredients')
            }}
          >
            Continue
          </button>
          </label>
        </section>

        <section className={`meal-log-step ${activeStep === 'ingredients' ? 'is-open' : ''}`}>
          <button
            type="button"
            className="meal-log-step__heading"
            onClick={() => canOpenIngredients && setActiveStep('ingredients')}
            aria-expanded={activeStep === 'ingredients'}
            disabled={!canOpenIngredients}
          >
            <span className="meal-log-step__number">3</span>
            <span><strong>Dishes &amp; ingredients</strong><small>{canOpenIngredients ? 'Add a saved dish, ingredients, or both.' : 'Choose a meal category and timestamp first.'}</small></span>
            <ChevronDown size={18} className={`collapse-icon ${activeStep === 'ingredients' ? 'open' : ''}`} />
          </button>
          <div className={`meal-log-step__content ingredient-picker ${activeStep === 'ingredients' ? 'is-visible' : ''}`} aria-hidden={activeStep !== 'ingredients'}> 
          <MealLogger
            ingredients={ingredients}
            frequentIngredients={mostFrequentIngredients}
            activeIngredientIds={activeIngredientIds}
            dishIngredientIds={dishIngredientIds}
            selectedDishIds={selectedDishIds}
            onDishIngredientsChange={(ids) => {
              setDishIngredientIds(ids)
              if (ids.length > 0 || mealForm.selectedIngredientIds.length > 0) setActiveStep('ingredients')
            }}
            onSelectedDishIdsChange={setSelectedDishIds}
            onClearIngredients={clearIngredientSelections}
            onIngredientCreated={onIngredientCreated}
            onMessage={setMessage}
          />

          <div className="ingredient-picker__header">
            <div>
              <span className="field-title">Ingredients</span>
              <p className="field-help">
                For individual meal additions.
              </p>
            </div>
            <div className="ingredient-picker__header-actions">
              <button
                type="button"
                className="ghost-button archive-toggle-button"
                onClick={() => setShowArchivedIngredients((current) => !current)}
                aria-label={showArchivedIngredients ? 'Hide archived ingredients' : 'Show archived ingredients'}
              >
                {showArchivedIngredients ? <Undo2 size={16} /> : <Archive size={16} />}
                <span>{showArchivedIngredients ? 'Hide archived' : 'Show archived'}</span>
              </button>
              <button type="button" className="ghost-button" onClick={() => setShowIngredientDraft((current) => !current)}>
                {showIngredientDraft ? <><X size={16} /> Close</> : <><Plus size={16} /> Add new ingredient</>}
              </button>
            </div>
          </div>

          {showIngredientDraft ? (
            <div className="inline-draft">
              <label className="field">
                <span>Ingredient name</span>
                <input
                  value={ingredientDraft.name}
                  onChange={(event) =>
                    setIngredientDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. garlic"
                />
              </label>
              <label className="field">
                <span>Tags</span>
                <input
                  value={ingredientDraft.tags}
                  onChange={(event) =>
                    setIngredientDraft((current) => ({
                      ...current,
                      tags: event.target.value,
                    }))
                  }
                  placeholder="FODMAP, dairy, gluten"
                />
              </label>
              {tagSuggestions.length > 0 ? (
                <div className="tag-suggestions">
                  <span className="field-help">Suggested tags from PocketBase</span>
                  <div className="tag-suggestions__list">
                    {tagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="ingredient-chip"
                        onClick={() => appendTagSuggestion(tag)}
                      >
                        <span>{tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="primary-button"
                onClick={createIngredient}
                disabled={savingIngredient}
              >
                {savingIngredient ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    {editingIngredientId ? 'Save ingredient' : 'Create ingredient'}
                  </>
                )}
              </button>
              {editingIngredientId ? (
                <button type="button" className="ghost-button" onClick={cancelIngredientEdit}>
                  Cancel ingredient edit
                </button>
              ) : null}
            </div>
          ) : null}

          <label className="field">
            <span>Search ingredients</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search local ingredients or Open Food Facts products"
            />
          </label>

          {externalSearchError ? <p className="form-message">{externalSearchError}</p> : null}

          {mostFrequentIngredients.length > 0 ? (
            <div className="frequency-panel">
              <div>
                <span className="field-title">Most frequent ingredients</span>
                <p className="field-help">
                  Based on the ingredients linked to your logged meals.
                </p>
              </div>
              <div className="frequency-panel__list">
                {mostFrequentIngredients.map((ingredient) => (
                  <button
                    key={ingredient.id}
                    type="button"
                    className="frequency-pill"
                    onClick={() => selectIngredient(ingredient.id)}
                    title="Add to this meal"
                  >
                    <span>{ingredient.name}</span>
                    <small>{ingredient.count} meals</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ingredient-list">
            {loadingIngredients ? (
              <div className="empty-state">Loading ingredients...</div>
            ) : filteredIngredients.length === 0 && !searchingExternal ? (
              <div className="empty-state">No matching ingredients.</div>
            ) : (
              <>
                {[
                  {
                    key: 'user',
                    label: 'My ingredients',
                    items: ingredientGroups.user,
                    open: showUserIngredients,
                    setOpen: setShowUserIngredients,
                  },
                  {
                    key: 'fodmap',
                    label: 'FODMAP library',
                    items: ingredientGroups.fodmap,
                    open: showFodmapIngredients,
                    setOpen: setShowFodmapIngredients,
                  },
                ].map((group) => (
                  <section key={group.key} className="ingredient-group">
                    <div className="ingredient-group__header">
                      <span className="field-title">{group.label} <small>({group.items.length})</small></span>
                      <button
                        type="button"
                        className="ghost-button ghost-button--compact"
                        onClick={() => group.setOpen((current) => !current)}
                        aria-expanded={group.open}
                      >
                        <ChevronDown size={16} className={`collapse-icon ${group.open ? 'open' : ''}`} />
                        {group.open ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {group.open ? (
                      <div
                        className="ingredient-group__items"
                        onScroll={(event) => {
                          const element = event.currentTarget
                          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) {
                            loadMoreIngredients(group.key as 'user' | 'fodmap', group.items.length)
                          }
                        }}
                      >
                        {group.items.slice(0, currentVisibleIngredientCounts[group.key as 'user' | 'fodmap']).map((ingredient) => {
                          const selected = mealForm.selectedIngredientIds.includes(ingredient.id)
                          const tags = normalizeTags(ingredient.tags)

                          return (
                            <div key={ingredient.id} className="ingredient-chip-row">
                              <button type="button" className={`ingredient-chip ${selected ? 'selected' : ''}`} onClick={() => toggleIngredient(ingredient.id)}>
                                <span>{ingredient.name}</span>
                                <small className={tags.length > 0 ? undefined : 'ingredient-chip__empty-tags'}>{tags.length > 0 ? tags.slice(0, 2).join(' / ') : '-'}</small>
                              </button>
                              <button type="button" className="ingredient-edit-button" onClick={() => loadIngredientForEdit(ingredient)} aria-label={`Edit ${ingredient.name}`} title="Edit ingredient"><Pencil size={14} /></button>
                            </div>
                          )
                        })}
                        {currentVisibleIngredientCounts[group.key as 'user' | 'fodmap'] < group.items.length ? (
                          <div className="empty-state empty-state--compact">
                            Scroll for 30 more ingredients…
                          </div>
                        ) : null}
                      </div>
                    ) : (<> </>
                    )}
                  </section>
                ))}
              </>
            )}

            {searchingExternal ? <div className="empty-state">Searching Open Food Facts...</div> : null}

            {!loadingIngredients && externalSuggestions.length > 0 ? (
              <div className="inline-draft">
                <span className="field-title">Open Food Facts suggestions</span>
                <p className="field-help">
                  Import one of these to save it into PocketBase with auto-mapped tags.
                </p>
                {externalSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="ingredient-chip"
                    onClick={() => importExternalSuggestion(suggestion)}
                    disabled={savingIngredient}
                    title={suggestion.details}
                  >
                    <span>{suggestion.name}</span>
                    {suggestion.tags.length > 0 ? (
                      <small>{suggestion.tags.slice(0, 3).join(' / ')}</small>
                    ) : (
                      <small>Imported from Open Food Facts</small>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="external-attribution">
              © Open Food Facts contributors. Product data provided by <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a> and available under the Open Database License (ODbL).
            </p>
          </div>

          <section className="management-grid">
            {showMealHistorySection && (
            <article className="management-card">
              <div className="management-card__header">
                <div>
                  <span className="field-title">Recent meals</span>
                  <p className="field-help">Open a meal to edit or delete it.</p>
                </div>
                <button
                  type="button"
                  className="ghost-button ghost-button--compact"
                  onClick={() => setShowMealHistory((current) => !current)}
                >
                  <ChevronDown size={16} className={`collapse-icon ${showMealHistory ? 'open' : ''}`} />
                  {showMealHistory ? 'Hide' : 'Show'}
                </button>
              </div>

              {showMealHistory ? (
                foodLogs.length === 0 ? (
                  <div className="empty-state">No meals logged yet.</div>
                ) : (
                  <div className="management-list">
                    {foodLogs.slice(0, 8).map((foodLog) => {
                      const ingredientsList = extractIngredients(foodLog)
                        .map((ingredient) => ingredient.name)
                        .join(', ')

                      return (
                        <div key={foodLog.id} className="management-row">
                          <div>
                            <strong>{foodLog.meal_name || 'Meal'}</strong>
                            <span>{formatDateTimeLocal(parseISO(foodLog.consumed_at))}</span>
                            <p>{ingredientsList || 'No ingredients linked.'}</p>
                          </div>
                          <div className="management-actions">
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => loadMealForEdit(foodLog)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => deleteMeal(foodLog)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              ) : (
                <div className="empty-state empty-state--compact">
                  {foodLogs.length} meals hidden. Expand to review recent entries.
                </div>
              )}
            </article>
            )}

          </section>

          {activeIngredientIds.length > 0 ? (
            <div className="selection-summary">
              <span>Selected</span>
              <strong>
                {activeIngredientIds.length} total · {mealForm.selectedIngredientIds.length} manual ·{' '}
                {dishIngredientIds.length} from dishes
              </strong>
              <button type="button" className="ghost-button ghost-button--compact" onClick={resetIngredients}>
                <RotateCcw size={15} /> Reset all
              </button>
            </div>
          ) : null}
          <div className="logger-actions">
            {editingMealId ? (
              <button type="button" className="ghost-button" onClick={cancelMealEdit}>
                Cancel meal edit
              </button>
            ) : null}
            <button type="submit" className="primary-button" disabled={savingMeal || activeIngredientIds.length === 0}>
              {savingMeal ? <><Loader2 size={16} className="spin" /> Saving</> : <><Save size={16} /> {editingMealId ? 'Save changes' : 'Save meal'}</>}
            </button>
          </div>
          </div>
        </section>

        {/*
          <button
            type="button"
            className="meal-log-step__heading"
            onClick={() => undefined}
            aria-expanded={false}
            disabled={activeIngredientIds.length === 0}
          >
            <span className="meal-log-step__number">4</span>
            <span><strong>Finish</strong><small>{activeIngredientIds.length > 0 ? 'Review and save this food log.' : 'Add a dish or ingredient first.'}</small></span>
            <ChevronDown size={18} className="collapse-icon" />
          </button>
          {false ? <div className="meal-log-step__content">
            {mealForm.mealCategory ? <div className="selection-summary"><span>Meal category</span><strong>{mealForm.mealCategory}</strong></div> : null}
            {activeIngredientIds.length > 0 ? <div className="selection-summary"><span>Selected</span><strong>{activeIngredientIds.length} total · {mealForm.selectedIngredientIds.length} manual · {dishIngredientIds.length} from dishes</strong><button type="button" className="ghost-button ghost-button--compact" onClick={resetIngredients}><RotateCcw size={15} /> Reset all</button></div> : null}
            <div className="logger-actions">
              {editingMealId ? <button type="button" className="ghost-button" onClick={cancelMealEdit}>Cancel meal edit</button> : null}
              <button type="submit" className="primary-button" disabled={savingMeal || activeIngredientIds.length === 0}>
                {savingMeal ? <><Loader2 size={16} className="spin" /> Saving</> : <><Save size={16} /> {editingMealId ? 'Save changes' : 'Save meal'}</>}
              </button>
            </div>
          </div> : null}
        </section>

        */}
        {message ? <p className="form-message">{message}</p> : null}
      </form>
    </article>
  )
}
