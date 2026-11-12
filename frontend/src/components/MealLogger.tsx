import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Loader2, Pencil, Plus, Search, Undo2, Utensils } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import type { DishRecord, IngredientRecord } from '../lib/tracker'
import { CreateDishModal } from './CreateDishModal'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'

type MealLoggerProps = {
  ingredients: IngredientRecord[]
  frequentIngredients: Array<{ id: string; name: string; count: number }>
  activeIngredientIds: string[]
  dishIngredientIds: string[]
  selectedDishIds: string[]
  onDishIngredientsChange: (ids: string[]) => void
  onSelectedDishIdsChange: (ids: string[]) => void
  onClearIngredients: () => void
  onIngredientCreated: (ingredient: IngredientRecord) => void
  onMessage: (message: string) => void
}

const toDish = (record: Record<string, unknown>): DishRecord => ({
  id: String(record.id),
  name: String(record.name),
  date: String(record.date ?? ''),
  ingredients: Array.isArray(record.ingredients) ? (record.ingredients as string[]) : [],
  isArchived: Boolean(record.isArchived),
  expand: record.expand as DishRecord['expand'],
})

export function MealLogger({ ingredients, frequentIngredients, activeIngredientIds, dishIngredientIds, selectedDishIds, onDishIngredientsChange, onSelectedDishIdsChange, onClearIngredients, onIngredientCreated, onMessage }: MealLoggerProps) {
  const [dishes, setDishes] = useState<DishRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreateDish, setShowCreateDish] = useState(false)
  const [editingDish, setEditingDish] = useState<DishRecord | null>(null)
  const [dishSearch, setDishSearch] = useState('')
  const [visibleDishState, setVisibleDishState] = useState({ search: '', count: 30 })
  const [pendingDeletion, setPendingDeletion] = useState<DishRecord | null>(null)
  const [showArchivedDishes, setShowArchivedDishes] = useState(false)

  const loadDishes = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await pb.collection('dishes').getFullList(500, { sort: 'name', expand: 'ingredients' })
      setDishes(rows.map((row) => toDish(row)))
    } catch (error) {
      console.error(error)
      setLoadError('Could not load saved dishes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadDishes(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadDishes])

  const selectedLookup = useMemo(() => new Set(dishIngredientIds), [dishIngredientIds])
  const filteredDishes = useMemo(() => {
    const search = dishSearch.trim().toLowerCase()
    const visibleDishes = showArchivedDishes ? dishes : dishes.filter((dish) => !dish.isArchived)
    return search ? visibleDishes.filter((dish) => dish.name.toLowerCase().includes(search)) : visibleDishes
  }, [dishSearch, dishes, showArchivedDishes])

  const visibleDishCount = visibleDishState.search === dishSearch ? visibleDishState.count : 30

  const visibleDishes = filteredDishes.slice(0, visibleDishCount)

  const toggleDish = (dish: DishRecord) => {
    const ingredientIds = dish.ingredients.filter(Boolean)
    if (selectedDishIds.includes(dish.id)) {
      const remainingDishIds = selectedDishIds.filter((id) => id !== dish.id)
      onDishIngredientsChange(Array.from(new Set(
        dishes.filter((item) => remainingDishIds.includes(item.id)).flatMap((item) => item.ingredients),
      )))
      onSelectedDishIdsChange(remainingDishIds)
      onMessage(`Removed ${dish.name} and its ingredients from this meal.`)
      return
    }

    const nextDishIds = [...selectedDishIds, dish.id]
    onDishIngredientsChange(Array.from(new Set(
      dishes.filter((item) => nextDishIds.includes(item.id)).flatMap((item) => item.ingredients),
    )))
    onSelectedDishIdsChange(nextDishIds)
    onMessage(`Added ${dish.name} (${ingredientIds.length} ingredients) to this meal.`)
  }

  const saveEditedDish = (savedDish: DishRecord) => {
    const previousDish = dishes.find((dish) => dish.id === savedDish.id)
    setDishes((current) => current.map((dish) => dish.id === savedDish.id ? savedDish : dish).sort((a, b) => a.name.localeCompare(b.name)))

    if (previousDish && selectedDishIds.includes(savedDish.id)) {
      const updatedDishes = dishes.map((dish) => dish.id === savedDish.id ? savedDish : dish)
      onDishIngredientsChange(Array.from(new Set(
        updatedDishes.filter((dish) => selectedDishIds.includes(dish.id)).flatMap((dish) => dish.ingredients),
      )))
    }

    setEditingDish(null)
    onMessage(`Updated ${savedDish.name}.`)
  }

  const archiveDish = async (dish: DishRecord) => {
    try {
      const isArchived = !dish.isArchived
      await pb.collection('dishes').update(dish.id, { isArchived })
      setDishes((current) => current.map((item) => item.id === dish.id ? { ...item, isArchived } : item))
      if (isArchived && selectedDishIds.includes(dish.id)) {
        const remaining = selectedDishIds.filter((id) => id !== dish.id)
        onSelectedDishIdsChange(remaining)
        onDishIngredientsChange(Array.from(new Set(dishes.filter((item) => remaining.includes(item.id) && item.id !== dish.id).flatMap((item) => item.ingredients))))
      }
      onMessage(`${isArchived ? 'Archived' : 'Restored'} ${dish.name}.`)
      setEditingDish(null)
      setPendingDeletion(null)
    } catch (error) {
      console.error(error)
      onMessage(`Could not ${dish.isArchived ? 'restore' : 'archive'} ${dish.name}.`)
    }
  }

  return (
    <section className="dish-picker" aria-labelledby="saved-dishes-title">
      <div className="ingredient-picker__header">
        <div>
          <span className="field-title" id="saved-dishes-title">Saved dishes</span>
          <p className="field-help">Choose a dish to add or remove all its ingredients.</p>
        </div>
        <div className="ingredient-picker__header-actions">
          <button type="button" className="ghost-button archive-toggle-button" onClick={() => setShowArchivedDishes((current) => !current)} aria-label={showArchivedDishes ? 'Hide archived dishes' : 'Show archived dishes'}>
            {showArchivedDishes ? <Undo2 size={16} /> : <Archive size={16} />}
            <span>{showArchivedDishes ? 'Hide archived' : 'Show archived'}</span>
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowCreateDish(true)}><Plus size={16} /> Create dish</button>
        </div>
      </div>

      {dishes.length > 0 ? (
        <label className="field dish-search">
          <span>Search dishes</span>
          <div className="input-with-icon">
            <Search size={16} />
            <input value={dishSearch} onChange={(event) => setDishSearch(event.target.value)} placeholder="Find a saved dish" />
          </div>
        </label>
      ) : null}

      {loading ? <div className="empty-state"><Loader2 size={16} className="spin" /> Loading dishes...</div> : null}
      {loadError ? <p className="form-message" role="alert">{loadError}</p> : null}
      {!loading && !loadError && dishes.length === 0 ? <div className="empty-state">No saved dishes yet. Select ingredients, then save your first dish.</div> : null}
      {!loading && dishes.length > 0 && filteredDishes.length === 0 ? <div className="empty-state">No dishes match “{dishSearch.trim()}”.</div> : null}

      {filteredDishes.length > 0 ? (
        <div
          className="dish-list"
          onScroll={(event) => {
            const element = event.currentTarget
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) {
              setVisibleDishState((current) => ({
                search: dishSearch,
                count: Math.min(
                  (current.search === dishSearch ? current.count : 30) + 30,
                  filteredDishes.length,
                ),
              }))
            }
          }}
        >
          {visibleDishes.map((dish) => {
            const selectedCount = dish.ingredients.filter((id) => selectedLookup.has(id)).length
            const selected = selectedDishIds.includes(dish.id)
            return (
              <div className="dish-card-row" key={dish.id}>
                <button type="button" className={`dish-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggleDish(dish)}>
                  <Utensils size={18} />
                  <span><strong>{dish.name}</strong><small>{dish.ingredients.length} ingredients{selectedCount > 0 ? ` · ${selectedCount} selected` : ''}</small></span>
                </button>
                <button type="button" className="dish-edit-button" onClick={() => setEditingDish(dish)} aria-label={`Edit ${dish.name}`} title="Edit dish ingredients"><Pencil size={15} /></button>
              </div>
            )
          })}
          {visibleDishes.length < filteredDishes.length ? <div className="empty-state empty-state--compact">Scroll for 30 more dishes…</div> : null}
        </div>
      ) : null}

      {showCreateDish ? (
        <CreateDishModal
          ingredientIds={activeIngredientIds}
          ingredients={ingredients}
          frequentIngredients={frequentIngredients}
          onIngredientCreated={onIngredientCreated}
          onClose={() => setShowCreateDish(false)}
          onSaved={(dish) => {
            setDishes((current) => [...current, dish].sort((a, b) => a.name.localeCompare(b.name)))
            setShowCreateDish(false)
            onClearIngredients()
            onMessage(`Saved ${dish.name} for reuse.`)
          }}
        />
      ) : null}

      {editingDish ? (
        <CreateDishModal dish={editingDish} ingredientIds={editingDish.ingredients} ingredients={ingredients} frequentIngredients={frequentIngredients} onIngredientCreated={onIngredientCreated} onClose={() => setEditingDish(null)} onDelete={() => setPendingDeletion(editingDish)} onSaved={saveEditedDish} />
      ) : null}
      {pendingDeletion ? <ConfirmDeleteModal title={pendingDeletion.isArchived ? 'Restore saved dish?' : 'Archive saved dish?'} message={pendingDeletion.isArchived ? `Restore “${pendingDeletion.name}” for use in new meals.` : `Hide “${pendingDeletion.name}” from new meals while preserving existing history.`} onCancel={() => setPendingDeletion(null)} onConfirm={() => archiveDish(pendingDeletion)} /> : null}
    </section>
  )
}
