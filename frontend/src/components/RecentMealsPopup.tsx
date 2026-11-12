import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock3, Pencil, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { extractDishes, extractIngredients, type FoodLogRecord } from '../lib/tracker'

type RecentMealsPopupProps = {
  foodLogs: FoodLogRecord[]
  onClose: () => void
  onEdit: (foodLog: FoodLogRecord) => void
  onDelete: (foodLog: FoodLogRecord) => void
}

export function RecentMealsPopup({ foodLogs, onClose, onEdit, onDelete }: RecentMealsPopupProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sortedLogs = [...foodLogs]
    .sort((left, right) => parseISO(right.consumed_at).getTime() - parseISO(left.consumed_at).getTime())
  const [visibleCount, setVisibleCount] = useState(12)
  const recentLogs = sortedLogs.slice(0, visibleCount)
  const hasMore = visibleCount < sortedLogs.length

  const loadMore = () => {
    if (hasMore) setVisibleCount((current) => Math.min(current + 10, sortedLogs.length))
  }

  return createPortal((
    <div className="modal-backdrop recent-meals-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="recent-meals-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-meals-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="recent-meals-popup__header">
          <div>
            <div className="section-label"><Clock3 size={16} /> Meal history</div>
            <h2 id="recent-meals-title">Recent meals</h2>
            <p>Review, edit, or remove your latest food logs.</p>
          </div>
          <button type="button" className="ghost-button ghost-button--compact" onClick={onClose} aria-label="Close recent meals">
            <X size={18} /> Close
          </button>
        </header>

        {foodLogs.length === 0 ? (
          <div className="empty-state">No meals logged yet.</div>
        ) : (
          <div
            className="recent-meals-popup__list"
            onScroll={(event) => {
              const element = event.currentTarget
              if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) loadMore()
            }}
          >
            {recentLogs.map((foodLog) => {
              const dishes = extractDishes(foodLog)
              const ingredients = extractIngredients(foodLog)
              const dishIngredientIds = new Set(dishes.flatMap((dish) => dish.ingredients))
              const otherIngredients = ingredients.filter((ingredient) => !dishIngredientIds.has(ingredient.id))

              return (
                <article className="recent-meal list-pop" key={foodLog.id}>
                  <div className="recent-meal__top">
                    <div>
                      <strong>{foodLog.meal_name || 'Meal'}</strong>
                      <span>{format(parseISO(foodLog.consumed_at), 'EEE, d MMM · p')}</span>
                    </div>
                    <div className="recent-meal__actions">
                      <button type="button" className="ghost-button ghost-button--compact" onClick={() => onEdit(foodLog)}>
                        <Pencil size={15} /> Edit
                      </button>
                      <button type="button" className="ghost-button ghost-button--compact" onClick={() => onDelete(foodLog)}>
                        <Trash2 size={15} /> Delete
                      </button>
                    </div>
                  </div>

                  {dishes.length > 0 ? (
                    <div className="calendar-dish-list">
                      {dishes.map((dish) => {
                        const expanded = dish.expand?.ingredients
                        const dishIngredients = expanded
                          ? (Array.isArray(expanded) ? expanded : [expanded])
                          : []

                        return (
                          <div className="calendar-dish" key={dish.id}>
                            <strong>{dish.name}</strong>
                            <span>{dishIngredients.map((ingredient) => ingredient.name).join(', ') || 'No ingredients linked.'}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}

                  {otherIngredients.length > 0 ? (
                    <p className="recent-meal__ingredients"><strong>{dishes.length > 0 ? 'Other ingredients:' : 'Ingredients:'}</strong> {otherIngredients.map((ingredient) => ingredient.name).join(', ')}</p>
                  ) : dishes.length === 0 ? (
                    <p className="recent-meal__ingredients">No ingredients linked.</p>
                  ) : null}
                </article>
              )
            })}
            {hasMore ? <div className="empty-state empty-state--compact">Scroll for 10 more meals…</div> : null}
          </div>
        )}
      </section>
    </div>
  ), document.body)
}
