import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Clock3, Search, ShieldCheck, Tags } from 'lucide-react'
import { extractIngredients, normalizeTags, type FoodLogRecord, type IngredientRecord, type SymptomLogRecord } from '../lib/tracker'
import { calculateStatsTriggers, classificationFill } from './statsAnalysis'
import { EvidenceBar } from './StatsPage'

type Props = {
  ingredients: IngredientRecord[]
  foodLogs: FoodLogRecord[]
  symptomLogs: SymptomLogRecord[]
  loading: boolean
}

type IngredientInsight = {
  ingredient: IngredientRecord
  meals: number
  symptomWindows: number
  symptomRate: number
  tags: string[]
  averageLag: number | null
  risk: 'high' | 'watch' | 'low'
}

const hoursBetween = (start: string, end: string) => {
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
  return Number.isFinite(value) ? value : null
}

const isFodmapLibraryIngredient = (ingredient: IngredientRecord) => ingredient.createdBy === 'fodmapLibrary'

const buildInsight = (ingredient: IngredientRecord, foodLogs: FoodLogRecord[], symptomLogs: SymptomLogRecord[]): IngredientInsight => {
  const meals = foodLogs.filter((log) => extractIngredients(log).some((item) => item.id === ingredient.id || item.name.toLowerCase() === ingredient.name.toLowerCase()))
  const lags = meals.flatMap((meal) => symptomLogs.map((symptom) => hoursBetween(meal.consumed_at, symptom.occurred_at)).filter((lag): lag is number => lag !== null && lag >= 0 && lag <= 24))
  const symptomWindows = meals.filter((meal) => symptomLogs.some((symptom) => {
    const lag = hoursBetween(meal.consumed_at, symptom.occurred_at)
    return lag !== null && lag >= 0 && lag <= 24
  })).length
  const symptomRate = meals.length ? Math.round((symptomWindows / meals.length) * 100) : 0
  return {
    ingredient,
    meals: meals.length,
    symptomWindows,
    symptomRate,
    tags: normalizeTags(ingredient.tags),
    averageLag: lags.length ? lags.reduce((sum, lag) => sum + lag, 0) / lags.length : null,
    risk: symptomRate >= 50 && symptomWindows >= 2 ? 'high' : symptomRate >= 25 ? 'watch' : 'low',
  }
}

export function IngredientSearchPage({ ingredients, foodLogs, symptomLogs, loading }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showUserIngredients, setShowUserIngredients] = useState(true)
  const [showFodmapIngredients, setShowFodmapIngredients] = useState(true)
  const [visibleCounts, setVisibleCounts] = useState({ user: 30, fodmap: 30 })
  const insights = useMemo(() => ingredients.map((ingredient) => buildInsight(ingredient, foodLogs, symptomLogs)), [ingredients, foodLogs, symptomLogs])
  const matches = insights.filter(({ ingredient }) => !ingredient.isArchived && (ingredient.name.toLowerCase().includes(query.trim().toLowerCase()) || normalizeTags(ingredient.tags).some((tag) => tag.toLowerCase().includes(query.trim().toLowerCase()))))
  const matchGroups = useMemo(() => ({
    user: matches.filter(({ ingredient }) => !isFodmapLibraryIngredient(ingredient)),
    fodmap: matches.filter(({ ingredient }) => isFodmapLibraryIngredient(ingredient)),
  }), [matches])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setVisibleCounts({ user: 30, fodmap: 30 })
  }

  const loadMore = (group: 'user' | 'fodmap', total: number) => {
    setVisibleCounts((current) => ({
      ...current,
      [group]: Math.min(current[group] + 30, total),
    }))
  }
  const selected = insights.find(({ ingredient }) => ingredient.id === selectedId) ?? matches[0] ?? null
  const statsRows = useMemo(() => calculateStatsTriggers(foodLogs, symptomLogs, ingredients).ingredientRows, [foodLogs, symptomLogs, ingredients])
  const selectedStats = useMemo(() => {
    if (!selected) return null
    const calculated = statsRows.find((row) => row.ingredientId === selected.ingredient.id)
    if (calculated) return calculated

    const safeObservationCount = Math.max(0, selected.meals - selected.symptomWindows)
    const confidenceMultiplier = 1 - Math.exp(-0.4 * selected.meals)
    return {
      ingredientId: selected.ingredient.id,
      ingredientName: selected.ingredient.name,
      riskPercent: selected.symptomRate,
      classification: selected.symptomRate >= 50 ? 'high' as const : selected.symptomRate >= 25 ? 'neutral' as const : 'safe' as const,
      observationCount: selected.meals,
      confidenceMultiplier,
      symptomObservationCount: selected.symptomWindows,
      safeObservationCount,
      averageLagHours: selected.averageLag,
    }
  }, [selected, statsRows])

  return (
    <div className="page-stack page-card">
      <section className="ingredient-explorer">
        <label className="ingredient-search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="Search ingredients or tags…" aria-label="Search ingredients or tags" />
          <span>{matches.length} found</span>
        </label>
        <div className="ingredient-explorer__body">
          <div className={`ingredient-results ${showUserIngredients !== showFodmapIngredients ? 'ingredient-results--single-open' : ''}`}>
            {loading ? <div className="empty-state">Loading ingredients…</div> : matches.length === 0 ? <div className="empty-state">No matching ingredients. Try a broader search.</div> : (
              <>
                {[
                  { key: 'user' as const, label: 'My ingredients', items: matchGroups.user, open: showUserIngredients, setOpen: setShowUserIngredients },
                  { key: 'fodmap' as const, label: 'FODMAP library', items: matchGroups.fodmap, open: showFodmapIngredients, setOpen: setShowFodmapIngredients },
                ].map((group) => (
                  <section key={group.key} className={`ingredient-results__group ${group.open ? 'ingredient-results__group--open' : ''}`}>
                    <div className="ingredient-results__group-header">
                      <span className="section-label">{group.label} <small>({group.items.length})</small></span>
                      <button type="button" className="ghost-button ghost-button--compact" onClick={() => group.setOpen((current) => !current)} aria-expanded={group.open}>
                        <ChevronDown size={16} className={`collapse-icon ${group.open ? 'open' : ''}`} />
                        {group.open ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {group.open ? (
                      <div
                        className="ingredient-results__group-items"
                        onScroll={(event) => {
                          const element = event.currentTarget
                          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) {
                            loadMore(group.key, group.items.length)
                          }
                        }}
                      >
                        {group.items.slice(0, visibleCounts[group.key]).map((insight) => (
                          <button key={insight.ingredient.id} type="button" className={`ingredient-result ${selected?.ingredient.id === insight.ingredient.id ? 'selected' : ''}`} onClick={() => setSelectedId(insight.ingredient.id)}>
                            <span><strong>{insight.ingredient.name}</strong><small>{insight.tags.length ? insight.tags.join(' · ') : 'No tags yet'}</small></span>
                            <span className={`risk-dot risk-dot--${insight.risk}`} />
                          </button>
                        ))}
                        {visibleCounts[group.key] < group.items.length ? <div className="empty-state empty-state--compact">Scroll for 30 more ingredients…</div> : null}
                      </div>
                    ) : <></>}
                  </section>
                ))}
              </>
            )}
          </div>

          <div className="ingredient-detail">
            {selected ? <>
              <div className="analysis-card__header ingredient-detail__header"><div className="ingredient-detail__title"><span className="section-label">Selected ingredient</span><h2>{selected.ingredient.name}</h2></div><span className={`badge badge--risk-${selected.risk}`}>{selected.risk === 'high' ? 'Higher observed signal' : selected.risk === 'watch' ? 'Watch pattern' : 'Low observed signal'}</span></div>
              <div className="analysis-summary-grid ingredient-summary">
                <div className="analysis-summary"><span>Meals with it</span><strong>{selected.meals}</strong><p>Logged exposures in your diary</p></div>
                <div className="analysis-summary"><span>Meals followed by symptoms</span><strong>{selected.symptomWindows}</strong><p>Logged symptoms within 24h</p></div>
                <div className="analysis-summary"><span>Observed rate</span><strong>{selected.symptomRate}%</strong><p>Symptom windows per exposure</p></div>
                <div className="analysis-summary"><span>Average timing</span><strong>{selected.averageLag === null ? '—' : `${selected.averageLag.toFixed(1)}h`}</strong><p>After logged meals</p></div>
              </div>
              <div className="ingredient-detail__notes">
                <div><Tags size={17} /><span><strong>Tags</strong>{selected.tags.length ? selected.tags.join(', ') : 'No tags assigned'}</span></div>
                <div><Clock3 size={17} /><span><strong>How this is calculated</strong>Symptoms are counted when logged 0–24 hours after a meal containing this ingredient.</span></div>
                <div><AlertTriangle size={17} /><span><strong>Use with care</strong>This is an association data, not defeintive proof of causation. Discuss persistent or severe symptoms with a clinician.</span></div>
              </div>
              {selectedStats ? (
                <section className="search-suspect-card">
                  <div className="suspect-card__topline"><strong>Trigger evidence</strong><span style={{ color: classificationFill[selectedStats.classification] }}>{selectedStats.riskPercent.toFixed(1)}% risk</span></div>
                  <div className="candidate-row__meter"><div className="candidate-row__fill" style={{ width: `${Math.max(4, selectedStats.riskPercent)}%`, background: classificationFill[selectedStats.classification] }} /></div>
                  <div className="suspect-evidence">
                    <EvidenceBar label="Confidence" detail={`${selectedStats.observationCount} logs`} width={selectedStats.confidenceMultiplier * 100} color="#5d7e61" />
                    <EvidenceBar label="Diarrhea vs safe days" detail={`${selectedStats.symptomObservationCount}x vs ${selectedStats.safeObservationCount}x`} width={selectedStats.symptomObservationCount + selectedStats.safeObservationCount > 0 ? (selectedStats.symptomObservationCount / (selectedStats.symptomObservationCount + selectedStats.safeObservationCount)) * 100 : 4} color="#a6534a" />
                    <EvidenceBar label="Average reaction lag" detail={selectedStats.averageLagHours === null ? 'n/a' : `${selectedStats.averageLagHours.toFixed(1)}h`} width={selectedStats.averageLagHours === null ? 4 : (selectedStats.averageLagHours / 48) * 100} color="#b87d3b" />
                  </div>
                </section>
              ) : null}
            </> : <div className="empty-state"><ShieldCheck size={18} /> Select an ingredient to inspect its diary pattern.</div>}
          </div>
        </div>
      </section>
      <section className="ingredient-search-guidance">
        <div><Clock3 size={17} /><span><strong>How this is calculated</strong>Symptoms are counted when logged 0–24 hours after a meal containing this ingredient.</span></div>
        <div><AlertTriangle size={17} /><span><strong>Use with care</strong>This is an association data, not defeintive proof of causation. Discuss persistent or severe symptoms with a clinician.</span></div>      </section>
    </div>
  )
}
