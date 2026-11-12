import { useMemo } from 'react'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { Droplets, UtensilsCrossed, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { type FoodLogRecord, type IngredientRecord, buildDiaryConfidenceSummary, type SymptomLogRecord, formatDayKey } from '../lib/tracker'
import homepageImage from '../assets/homepage_image.png'

type HomePageProps = { ingredients: IngredientRecord[]; foodLogs: FoodLogRecord[]; symptomLogs: SymptomLogRecord[]; loading: boolean; onRefresh: () => void }
type ActivityEvent = { kind: 'meal' | 'bowel'; tone: 'meal' | 'safe' | 'danger'; at: string; label: string; id: string }

export function HomePage({ ingredients, foodLogs, symptomLogs, loading }: HomePageProps) {
  const navigate = useNavigate()
  const confidence = useMemo(() => buildDiaryConfidenceSummary(foodLogs, symptomLogs, ingredients), [foodLogs, symptomLogs, ingredients])
  const activityDays = useMemo(() => {
    const days = new Map<string, { date: string; events: ActivityEvent[] }>()
    for (const meal of foodLogs) { const key = formatDayKey(meal.consumed_at); const day = days.get(key) ?? { date: meal.consumed_at, events: [] }; day.events.push({ kind: 'meal', tone: 'meal', at: meal.consumed_at, label: meal.meal_name || 'Meal', id: meal.id }); days.set(key, day) }
    for (const log of symptomLogs) { const key = formatDayKey(log.occurred_at); const day = days.get(key) ?? { date: log.occurred_at, events: [] }; day.events.push({ kind: 'bowel', tone: log.bristol_type >= 4 && log.bristol_type <= 5 ? 'safe' : 'danger', at: log.occurred_at, label: `Type ${log.bristol_type} bowel event`, id: log.id }); days.set(key, day) }
    return [...days.values()]
      .map((day) => ({ ...day, events: [...day.events].sort((a, b) => parseISO(b.at).getTime() - parseISO(a.at).getTime()) }))
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
      .slice(0, 8)
  }, [foodLogs, symptomLogs])

  return <div className="page-stack">
    <section className="hero-card home-hero-card" style={{ backgroundImage: `url(${homepageImage})` }}>
      <div className="hero-copy">
        <h2>Welcome to Gutmost</h2>
        <p>Keep your daily meal logged, build your own analysis.</p>
        <div className="hero-actions home-hero-actions">
          <button type="button" className="primary-button" onClick={() => navigate('/ingredients')}>
            <Search size={16} /> Search ingredients
          </button>
          <button type="button" className="ghost-button" onClick={() => navigate('/meals')}>
            <UtensilsCrossed size={16} /> Log a meal
          </button>
          <button type="button" className="ghost-button" onClick={() => navigate('/bowel')}>
            <Droplets size={16} /> Log bowel movement
          </button>
        </div>
      </div>
    </section>
    <section className="overview-grid">
      <article className="overview-card home-overview-card home-overview-card--evidence">
        <h3>Why Food Diary?</h3>
        <p>A review of food interaction in IBS reports that more than 60% of patients notice symptoms after meals, 
          often within the first few hours. That timing makes a detailed diary useful to monitor one's tolerance against different food types.</p>
        <p>Fermentable carbohydrates (FODMAPs) can draw water into the bowel and increase gas production during fermentation. 
          Research suggests that reducing, then systematically reintroducing these trigger foods in diet is a safer way to explore tolerance with professional guidance.</p>
        <p className="field-help">Source: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4112903/" target="_blank" rel="noreferrer">Cuomo et al., World Journal of Gastroenterology (2014)</a>. 
        <br/>Educational context only; this app does not diagnose allergy, IBS, or intolerance.</p>
      </article>
      <article className="overview-card home-overview-card home-overview-card--confidence">
        <h3>Data Confidence</h3>
        <p className={`confidence-level-text confidence-level-text--${confidence.level}`}>{confidence.title}</p>
        <p>{confidence.description}</p>
        <div className="confidence-signals">
          {
            confidence.signals.map((signal) => 
            <div key={signal.label} className={`confidence-signal confidence-signal--${signal.tone}`}>
              <span>{signal.label}</span>
              <strong>{signal.value}</strong>
            </div>)
          }
        </div>
        <p className="field-help">{confidence.nextStep}</p>
      </article>
      <article className="overview-card home-overview-card home-overview-card--activity">
        <h3>Recent activity</h3>
        {
          loading ? 
            <div className="empty-state">Loading today&apos;s activity...</div>
          : activityDays.length === 0 ? 
              <div className="empty-state">No entries yet. Start with a meal or bowel log so the dashboard can begin learning from real data.</div> 
            : <>
              <div className="activity-timeline">
              {
                activityDays.map((day) => { 
                  const date = parseISO(day.date); 
                  const label = isToday(date) ? 
                    'Today' 
                  : isYesterday(date) ? 
                    'Yesterday' 
                    : format(date, 'EEE, d MMM'); 
                    return (
                      <div className="activity-day" key={formatDayKey(day.date)}>
                        <div className="activity-day__timeline">{day.events.map((event) => 
                              <div className={`activity-timeline-row activity-timeline-row--${event.kind} activity-timeline-row--${event.tone}`} key={event.id}>
                                <div className="activity-event">
                                  <strong>{event.label}</strong>
                                  <time>{format(parseISO(event.at), 'h:mm a')}</time>
                                </div>
                              </div>
                          )}
                        </div>
                        <div className="activity-day__label">{label}</div>
                      </div> 
                    )
                })
              }
          </div>
              <button type="button" className="ghost-button activity-view-more" onClick={() => navigate('/calendar')}>
                View more
              </button>
            </>
        }
      </article>
    </section>
  </div>
}
