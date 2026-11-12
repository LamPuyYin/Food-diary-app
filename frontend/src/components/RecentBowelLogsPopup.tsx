import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Droplets, Pencil, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { SymptomLogRecord } from '../lib/tracker'

type RecentBowelLogsPopupProps = {
  symptomLogs: SymptomLogRecord[]
  onClose: () => void
  onEdit: (log: SymptomLogRecord) => void
  onDelete: (log: SymptomLogRecord) => void
}

const bristolSummary = (type: number) => {
  if (type <= 2) return 'Constipation range'
  if (type <= 4) return 'Typical range'
  return 'Loose stool range'
}

export function RecentBowelLogsPopup({ symptomLogs, onClose, onEdit, onDelete }: RecentBowelLogsPopupProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sortedLogs = [...symptomLogs]
    .sort((left, right) => parseISO(right.occurred_at).getTime() - parseISO(left.occurred_at).getTime())
  const [visibleCount, setVisibleCount] = useState(12)
  const recentLogs = sortedLogs.slice(0, visibleCount)
  const hasMore = visibleCount < sortedLogs.length

  const loadMore = () => {
    if (hasMore) setVisibleCount((current) => Math.min(current + 10, sortedLogs.length))
  }

  return createPortal((
    <div className="modal-backdrop recent-meals-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="recent-meals-popup recent-bowel-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-bowel-logs-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="recent-meals-popup__header">
          <div>
            <div className="section-label"><Droplets size={16} /> Bowel history</div>
            <h2 id="recent-bowel-logs-title">Recent bowel logs</h2>
            <p>Review, edit, or remove your latest entries.</p>
          </div>
          <button type="button" className="ghost-button ghost-button--compact" onClick={onClose} aria-label="Close recent bowel logs">
            <X size={18} /> Close
          </button>
        </header>

        {recentLogs.length === 0 ? (
          <div className="empty-state">No bowel logs yet.</div>
        ) : (
          <div
            className="recent-meals-popup__list"
            onScroll={(event) => {
              const element = event.currentTarget
              if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) loadMore()
            }}
          >
            {recentLogs.map((log) => (
              <article className="recent-meal recent-bowel-log list-pop" key={log.id}>
                <div className="recent-meal__top">
                  <div className="recent-bowel-log__title">
                    <span className="bristol-type-badge">Type {log.bristol_type}</span>
                    <strong>{bristolSummary(log.bristol_type)}</strong>
                    <span>{format(parseISO(log.occurred_at), 'EEE, d MMM · p')}</span>
                  </div>
                  <div className="recent-meal__actions">
                    <button type="button" className="ghost-button ghost-button--compact" onClick={() => onEdit(log)}><Pencil size={15} /> Edit</button>
                    <button type="button" className="ghost-button ghost-button--compact" onClick={() => onDelete(log)}><Trash2 size={15} /> Delete</button>
                  </div>
                </div>
                <p className="recent-meal__ingredients"><strong>Notes:</strong> {log.notes?.trim() || 'No notes recorded.'}</p>
              </article>
            ))}
            {hasMore ? <div className="empty-state empty-state--compact">Scroll for 10 more bowel logs…</div> : null}
          </div>
        )}
      </section>
    </div>
  ), document.body)
}
