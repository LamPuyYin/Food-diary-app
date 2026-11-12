import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ChevronDown, Loader2, Plus, Save, Undo2, X } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import type { DishRecord, IngredientRecord } from '../lib/tracker'

const getTagDraftParts = (value: string) => {
  const parts = value.split(',')
  const currentPart = parts.pop() ?? ''

  return { parts, currentPart }
}

type CreateDishModalProps = {
  ingredientIds: string[]
  ingredients: IngredientRecord[]
  dish?: DishRecord
  frequentIngredients?: Array<{ id: string; name: string; count: number }>
  onIngredientCreated?: (ingredient: IngredientRecord) => void
  onClose: () => void
  onSaved: (dish: DishRecord) => void
  onDelete?: () => void
}

export function CreateDishModal({ ingredientIds, ingredients, dish, frequentIngredients = [], onIngredientCreated, onClose, onSaved, onDelete }: CreateDishModalProps) {
  const [name, setName] = useState(dish?.name ?? '')
  const [selectedIds, setSelectedIds] = useState<string[]>(dish?.ingredients ?? ingredientIds)
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [showUserIngredients, setShowUserIngredients] = useState(true)
  const [showFodmapIngredients, setShowFodmapIngredients] = useState(true)
  const [showIngredientDraft, setShowIngredientDraft] = useState(false)
  const [ingredientName, setIngredientName] = useState('')
  const [ingredientTags, setIngredientTags] = useState('')
  const [savingIngredient, setSavingIngredient] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedIngredients = useMemo(
    () => ingredients.filter((ingredient) => selectedIds.includes(ingredient.id)),
    [ingredients, selectedIds],
  )
  const filteredIngredients = useMemo(() => {
    const search = ingredientSearch.trim().toLowerCase()
    const selectableIngredients = ingredients.filter((ingredient) => !ingredient.isArchived || selectedIds.includes(ingredient.id))
    return search ? selectableIngredients.filter((ingredient) => ingredient.name.toLowerCase().includes(search)) : selectableIngredients
  }, [ingredientSearch, ingredients, selectedIds])
  const ingredientGroups = useMemo(
    () => ({
      user: filteredIngredients.filter((ingredient) => ingredient.createdBy !== 'fodmapLibrary'),
      fodmap: filteredIngredients.filter((ingredient) => ingredient.createdBy === 'fodmapLibrary'),
    }),
    [filteredIngredients],
  )
  const tagSuggestions = useMemo(() => {
    const { currentPart } = getTagDraftParts(ingredientTags)
    const query = currentPart.trim().toLowerCase()

    if (query.length === 0) {
      return []
    }

    const existingTags = new Set(
      ingredientTags
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    )
    const seenTags = new Set<string>()

    return ingredients
      .flatMap((ingredient) => (Array.isArray(ingredient.tags) ? ingredient.tags : []))
      .map((tag) => String(tag).trim())
      .filter((tag) => tag.length > 0)
      .filter((tag) => tag.toLowerCase().includes(query))
      .filter((tag) => {
        const normalized = tag.toLowerCase()
        if (existingTags.has(normalized) || seenTags.has(normalized)) {
          return false
        }
        seenTags.add(normalized)
        return true
      })
      .slice(0, 6)
  }, [ingredientTags, ingredients])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  const saveDish = async () => {
    const cleanName = name.trim().replace(/\s+/g, ' ')
    if (!cleanName) {
      setError('Dish name is required.')
      return
    }
    if (selectedIds.length === 0) {
      setError('Select at least one ingredient first.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: cleanName,
        ingredients: selectedIds,
        ...(dish ? {} : { date: new Date().toISOString() }),
      }
      const saved = dish
        ? await pb.collection('dishes').update(dish.id, payload)
        : await pb.collection('dishes').create(payload)
      onSaved({
        id: saved.id,
        name: String(saved.name),
        date: String(saved.date),
        ingredients: Array.isArray(saved.ingredients) ? (saved.ingredients as string[]) : [],
        isArchived: Boolean(saved.isArchived),
      })
    } catch (caught) {
      console.error(caught)
      const status = typeof caught === 'object' && caught && 'status' in caught ? caught.status : null
      setError(status === 400 ? 'Check the dish name and ingredients.' : 'Could not save the dish.')
    } finally {
      setSaving(false)
    }
  }

  const createIngredient = async () => {
    const cleanName = ingredientName.trim().replace(/\s+/g, ' ')
    if (!cleanName) {
      setError('Ingredient name is required.')
      return
    }
    const existing = ingredients.find((ingredient) => ingredient.name.toLowerCase() === cleanName.toLowerCase())
    if (existing) {
      setSelectedIds((current) => Array.from(new Set([...current, existing.id])))
      setError(null)
      setIngredientName('')
      setIngredientTags('')
      setShowIngredientDraft(false)
      return
    }

    setSavingIngredient(true)
    setError(null)
    try {
      const created = await pb.collection('ingredients').create({
        name: cleanName,
        tags: ingredientTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        createdBy: 'user',
      })
      const ingredient: IngredientRecord = {
        id: created.id,
        name: String(created.name),
        tags: created.tags as IngredientRecord['tags'],
      }
      onIngredientCreated?.(ingredient)
      setSelectedIds((current) => [...current, ingredient.id])
      setIngredientName('')
      setIngredientTags('')
      setShowIngredientDraft(false)
    } catch (caught) {
      console.error(caught)
      setError('Could not create the ingredient.')
    } finally {
      setSavingIngredient(false)
    }
  }

  const appendTagSuggestion = (tag: string) => {
    setIngredientTags((current) => {
      const { parts } = getTagDraftParts(current)
      const cleanedParts = parts.map((part) => part.trim()).filter(Boolean)

      return [...cleanedParts, tag].join(', ')
    })
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section className="dish-modal" role="dialog" aria-modal="true" aria-labelledby="dish-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="dish-modal__header">
          <div>
            <span className="section-label">Reusable dish</span>
            <h2 id="dish-modal-title">{dish ? 'Edit dish ingredients' : 'Save current meal as a dish'}</h2>
          </div>
          <button type="button" className="ghost-button ghost-button--compact" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Dish name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Garlic Butter Pasta" />
        </label>

        <div className="dish-modal__ingredients">
          <span className="field-title">{selectedIngredients.length} ingredients</span>
          <p>{selectedIngredients.map((ingredient) => ingredient.name).join(', ') || 'No ingredients selected.'}</p>
        </div>

        <div className="dish-ingredient-editor">
          <div className="ingredient-picker__header">
            <div>
              <span className="field-title">Ingredients</span>
              <p className="field-help">Search, select, or create the ingredients used in this dish.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setShowIngredientDraft((current) => !current)}>
              {showIngredientDraft ? <><X size={16} /> Close</> : <><Plus size={16} /> Add new ingredient</>}
            </button>
          </div>

          {showIngredientDraft ? (
            <div className="inline-draft">
              <label className="field">
                <span>Ingredient name</span>
                <input value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} placeholder="e.g. garlic" />
              </label>
              <label className="field">
                <span>Tags</span>
                <input value={ingredientTags} onChange={(event) => setIngredientTags(event.target.value)} placeholder="FODMAP, dairy, gluten" />
              </label>
              {tagSuggestions.length > 0 ? (
                <div className="tag-suggestions">
                  <span className="field-help">Suggested tags from PocketBase</span>
                  <div className="tag-suggestions__list">
                    {tagSuggestions.map((tag) => (
                      <button key={tag} type="button" className="ingredient-chip" onClick={() => appendTagSuggestion(tag)}>
                        <Plus size={14} /> {tag}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <button type="button" className="primary-button" onClick={createIngredient} disabled={savingIngredient}>
                {savingIngredient ? <><Loader2 size={16} className="spin" /> Saving</> : <><Plus size={16} /> Create ingredient</>}
              </button>
            </div>
          ) : null}

          <label className="field">
            <span>Search ingredients</span>
            <input value={ingredientSearch} onChange={(event) => setIngredientSearch(event.target.value)} placeholder="Find an ingredient" />
          </label>

          {frequentIngredients.length > 0 ? (
            <div className="frequency-panel">
              <span className="field-title">Most frequent ingredients</span>
              <div className="frequency-panel__list">
                {frequentIngredients.map((ingredient) => (
                  <button
                    key={ingredient.id}
                    type="button"
                    className={`frequency-pill ${selectedIds.includes(ingredient.id) ? 'selected' : ''}`}
                    onClick={() => setSelectedIds((current) => Array.from(new Set([...current, ingredient.id])))}
                  >
                    <span>{ingredient.name}</span>
                    <small>{ingredient.count} meals</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

            <div className="dish-ingredient-editor__list">
              {filteredIngredients.length === 0 ? <div className="empty-state">No matching ingredients.</div> : (
                [
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
                      <div className="ingredient-group__items">
                        {group.items.map((ingredient) => {
                          const selected = selectedIds.includes(ingredient.id)
                          return (
                            <button
                              key={ingredient.id}
                              type="button"
                              className={`ingredient-chip ${selected ? 'selected' : ''}`}
                              aria-pressed={selected}
                              onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== ingredient.id) : [...current, ingredient.id])}
                            >
                              <span>{ingredient.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="empty-state empty-state--compact">{group.items.length} ingredients hidden.</div>
                    )}
                  </section>
                ))
              )}
            </div>
        </div>

        {error ? <p className="form-message" role="alert">{error}</p> : null}
        <div className="logger-actions editor-modal-actions">
          {dish && onDelete ? <button type="button" className={dish.isArchived ? 'ghost-button' : 'danger-button'} onClick={onDelete} disabled={saving}>{dish.isArchived ? <><Undo2 size={16} /> Restore dish</> : <><Archive size={16} /> Archive dish</>}</button> : null}
          <div className="editor-modal-actions__secondary">
            <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="primary-button" onClick={saveDish} disabled={saving}>
              {saving ? <><Loader2 size={16} className="spin" /> Saving</> : <><Save size={16} /> {dish ? 'Save changes' : 'Save dish'}</>}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
