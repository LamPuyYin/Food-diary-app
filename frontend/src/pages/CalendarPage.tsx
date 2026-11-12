import { useMemo, useState } from 'react'
import {
  addMonths,
  compareAsc,
  compareDesc,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Toilet, UtensilsCrossed } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  extractIngredients,
  extractDishes,
  formatDayKey,
  type FoodLogRecord,
  type IngredientRecord,
  type SymptomLogRecord,
} from '../lib/tracker'

type CalendarPageProps = {
  foodLogs: FoodLogRecord[]
  symptomLogs: SymptomLogRecord[]
  ingredients: IngredientRecord[]
  loading: boolean
}

export function CalendarPage({
  foodLogs,
  symptomLogs,
  loading,
}: CalendarPageProps) {
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => new Date())

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  )

  const dayMap = useMemo(() => {
    const map = new Map<string, { meals: FoodLogRecord[]; symptoms: SymptomLogRecord[] }>()

    for (const foodLog of foodLogs) {
      const key = formatDayKey(foodLog.consumed_at)
      const bucket = map.get(key) ?? { meals: [], symptoms: [] }
      bucket.meals.push(foodLog)
      map.set(key, bucket)
    }

    for (const symptomLog of symptomLogs) {
      const key = formatDayKey(symptomLog.occurred_at)
      const bucket = map.get(key) ?? { meals: [], symptoms: [] }
      bucket.symptoms.push(symptomLog)
      map.set(key, bucket)
    }

    for (const bucket of map.values()) {
      bucket.meals.sort((a, b) => compareDesc(parseISO(a.consumed_at), parseISO(b.consumed_at)))
      bucket.symptoms.sort((a, b) => compareDesc(parseISO(a.occurred_at), parseISO(b.occurred_at)))
    }

    return map
  }, [foodLogs, symptomLogs])

  const selectedKey = format(selectedDate, 'yyyy-MM-dd')
  const selectedBucket = dayMap.get(selectedKey) ?? { meals: [], symptoms: [] }

  const monthlyTotals = useMemo(
    () => ({
      meals: foodLogs.filter((item) => isSameMonth(parseISO(item.consumed_at), month)).length,
      symptoms: symptomLogs.filter((item) => isSameMonth(parseISO(item.occurred_at), month)).length,
    }),
    [foodLogs, symptomLogs, month],
  )

  return (
    <div className="calendar-layout">
      <section className="calendar-card">
        <div className="calendar-header">
          <div>
            <h2>Daily food logs</h2>
          </div>

          <div className="calendar-controls">
            <button type="button" className="ghost-button" onClick={() => setMonth(subMonths(month, 1))}>
              <ChevronLeft size={16} />
            </button>
            <div className="calendar-month">{format(month, 'MMM yyyy')}</div>
            <button type="button" className="ghost-button" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="calendar-stats">
          <div className="stat">
            <span>Meals this month</span>
            <strong>{monthlyTotals.meals}</strong>
          </div>
          <div className="stat">
            <span>Bowel logs this month</span>
            <strong>{monthlyTotals.symptoms}</strong>
          </div>
        </div>

        <div className="calendar-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <div key={day} className="calendar-weekday">
              {day}
            </div>
          ))}

          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const bucket = dayMap.get(key)
            const isCurrentMonth = isSameMonth(day, month)
            const hasEntries = Boolean(bucket?.meals.length || bucket?.symptoms.length)
            const isSelected = isSameDay(day, selectedDate)

            return (
              <button
                key={key}
                type="button"
                className={`calendar-day ${isCurrentMonth ? '' : 'muted'} ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedDate(day)}
              >
                <span className="calendar-day__number">{format(day, 'd')}</span>
                <span className="calendar-day__meta">
                  {hasEntries ? '' : 'No logs'}
                </span>
                {hasEntries ? (
                  <div className="calendar-day__marks">
                    {bucket?.meals.length ? (
                      <span className="calendar-day__mark calendar-day__mark--meal">
                        {bucket.meals.length} <UtensilsCrossed size={14} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                    ) : null}
                    {bucket?.symptoms.length ? (
                      <span className="calendar-day__mark calendar-day__mark--symptom">
                        {bucket.symptoms.length} <Toilet size={14} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {isToday(day) ? <em>Today</em> : null}
              </button>
            )
          })}
        </div>
      </section>

      <section className="calendar-card calendar-details">
        <div className="calendar-details__header">
          <div>
            <span className="sidebar-kicker">Selected day</span>
            <h3>{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h3>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading logs...</div>
        ) : selectedBucket.meals.length === 0 && selectedBucket.symptoms.length === 0 ? (
          <div className="empty-state">No logs recorded for this day.</div>
        ) : (
          <div className="day-feed calendar-selection-skew" key={selectedKey}>
            {[
              ...selectedBucket.meals.map((item) => ({ kind: 'meal' as const, at: item.consumed_at, item })),
              ...selectedBucket.symptoms.map((item) => ({ kind: 'symptom' as const, at: item.occurred_at, item })),
            ]
              .sort((a, b) => compareAsc(parseISO(a.at), parseISO(b.at)))
              .map((entry, index) => {
                if (entry.kind === 'meal') {
                  const foodLog = entry.item
                  const mealIngredients = extractIngredients(foodLog)
                  const mealDishes = extractDishes(foodLog)
                  const dishIngredientIds = new Set(
                    mealDishes.flatMap((dish) => dish.ingredients),
                  )
                  const manualIngredients = mealIngredients.filter(
                    (ingredient) => !dishIngredientIds.has(ingredient.id),
                  )

                  return (
                    <article key={foodLog.id} className="feed-item meal" style={{ animationDelay: `${index * 55}ms` }}>
                      <div className="feed-item__top">
                        <div>
                          <strong>{foodLog.meal_name || 'Meal'}</strong>
                          <span>{format(parseISO(foodLog.consumed_at), 'p')}</span>
                        </div>
                        <button
                          type="button"
                          className="feed-item__edit"
                          onClick={() => {
                            const state = { editMealId: foodLog.id, editMeal: foodLog }
                            console.info('[CalendarPage] editing meal', {
                              id: foodLog.id,
                              meal: foodLog,
                              navigationState: state,
                            })
                            navigate('/meals', { state })
                          }}
                          aria-label={`Edit ${foodLog.meal_name || 'meal'}`}
                          title="Edit meal"
                        >
                          Edit
                        </button>
                      </div>
                      {mealDishes.length > 0 ? (
                        <div className="calendar-dish-list">
                          {mealDishes.map((dish) => {
                            const expanded = dish.expand?.ingredients
                            const dishIngredients = expanded
                              ? (Array.isArray(expanded) ? expanded : [expanded])
                              : []
                            return (
                              <div className="calendar-dish" key={dish.id}>
                                <strong>{dish.name}</strong>
                                <span>
                                  {dishIngredients.map((ingredient) => ingredient.name).join(', ') ||
                                    'No ingredients linked.'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                      {manualIngredients.length > 0 ? (
                        <p>
                          <strong>Other ingredients:</strong>{' '}
                          {manualIngredients.map((ingredient) => ingredient.name).join(', ')}
                        </p>
                      ) : mealDishes.length === 0 ? (
                        <p>{mealIngredients.map((ingredient) => ingredient.name).join(', ') || 'No ingredients linked.'}</p>
                      ) : null}
                    </article>
                  )
                }

                const symptomLog = entry.item

                return (
                  <article key={symptomLog.id} className="feed-item symptom" style={{ animationDelay: `${index * 55}ms` }}>
                    <div className="feed-item__top">
                      <div>
                        <strong>Bristol type {symptomLog.bristol_type}</strong>
                        <span>{format(parseISO(symptomLog.occurred_at), 'p')}</span>
                      </div>
                      <button
                        type="button"
                        className="feed-item__edit"
                        onClick={() => {
                          const state = { editSymptomId: symptomLog.id, editSymptom: symptomLog }
                          console.info('[CalendarPage] editing bowel log', {
                            id: symptomLog.id,
                            log: symptomLog,
                            navigationState: state,
                          })
                          navigate('/bowel', { state })
                        }}
                        aria-label={`Edit bowel log from ${format(parseISO(symptomLog.occurred_at), 'p')}`}
                        title="Edit bowel log"
                      >
                        Edit
                      </button>
                    </div>
                    <p>{symptomLog.notes?.trim() || 'No notes recorded.'}</p>
                  </article>
                )
              })}
          </div>
        )}
      </section>
    </div>
  )
}



