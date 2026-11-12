import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ChevronDown, Clock3, Droplets, Flame, Loader2, Save } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import {
  emptySymptomForm,
  formatDateTimeLocal,
  toIsoString,
  type SymptomFormState,
  type SymptomLogRecord,
} from '../lib/tracker'
import { RecentBowelLogsPopup } from '../components/RecentBowelLogsPopup'
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal'

type BowelLoggerPageProps = {
  symptomLogs: SymptomLogRecord[]
  onSaved: () => void
}

type BowelEditNavigationState = {
  editSymptomId?: string
  editSymptom?: SymptomLogRecord
}

const BRISTOL_TYPES = [
  { type: 1, description: 'Separate hard lumps, severe constipation.' },
  { type: 2, description: 'Sausage-shaped but lumpy, mild constipation.' },
  { type: 3, description: 'Sausage-like with cracks, normal/healthy.' },
  { type: 4, description: 'Smooth and soft, ideal healthy bowel movement.' },
  { type: 5, description: 'Soft blobs with edges, mild urgency or low fiber.' },
  { type: 6, description: 'Fluffy mushy pieces, mild diarrhea.' },
  { type: 7, description: 'Watery liquid stool, severe diarrhea.' },
] as const

export function BowelLoggerPage({ symptomLogs, onSaved }: BowelLoggerPageProps) {
  const showLogManagement = false
  const [form, setForm] = useState<SymptomFormState>(() => emptySymptomForm())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [editingSymptomId, setEditingSymptomId] = useState<string | null>(null)
  const [showRecentLogs, setShowRecentLogs] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<SymptomLogRecord | null>(null)
  const handledEditLocationKey = useRef<string | null>(null)
  const location = useLocation()

  const submitSymptom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const payload: Record<string, unknown> = {
        occurred_at: toIsoString(form.occurredAt),
        bristol_type: form.bristolType,
      }

      const notes = form.notes.trim()
      if (notes) {
        payload.notes = notes
      }

      if (editingSymptomId) {
        await pb.collection('symptom_logs').update(editingSymptomId, payload)
      } else {
        await pb.collection('symptom_logs').create(payload)
      }

      setForm(emptySymptomForm())
      setEditingSymptomId(null)
      setMessage(editingSymptomId ? 'Bowel log updated.' : 'Bowel movement saved.')
      onSaved()
    } catch (error) {
      console.error(error)
      setMessage('Could not save the bowel log.')
    } finally {
      setSaving(false)
    }
  }

  const loadSymptomForEdit = (log: SymptomLogRecord) => {
    console.info('[BowelLoggerPage] loading bowel log for edit', {
      id: log.id,
      log,
    })
    setEditingSymptomId(log.id)
    setForm({
      occurredAt: formatDateTimeLocal(parseISO(log.occurred_at)),
      bristolType: log.bristol_type,
      notes: log.notes ?? '',
    })
    setMessage(`Editing type ${log.bristol_type}.`)
  }

  const deleteSymptom = async (log: SymptomLogRecord) => {
    try {
      await pb.collection('symptom_logs').delete(log.id)
      if (editingSymptomId === log.id) {
        setEditingSymptomId(null)
        setForm(emptySymptomForm())
      }
      setMessage('Bowel log deleted.')
      setPendingDeletion(null)
      onSaved()
    } catch (error) {
      console.error(error)
      setMessage('Could not delete the bowel log.')
    }
  }

  const cancelSymptomEdit = () => {
    setEditingSymptomId(null)
    setForm(emptySymptomForm())
    setMessage('Bowel log edit cancelled.')
  }

  useEffect(() => {
    const editState = location.state as BowelEditNavigationState | null
    const editSymptomId = editState?.editSymptomId
    const log = editState?.editSymptom ?? (editSymptomId
      ? symptomLogs.find((item) => item.id === editSymptomId)
      : undefined)
    console.info('[BowelLoggerPage] edit navigation received', {
      locationState: location.state,
      editSymptomId,
      sharedSymptomLogCount: symptomLogs.length,
      matchedLog: log,
    })
    if (!log || handledEditLocationKey.current === location.key) return

    // Replacing this route to clear state can remount the logger and wipe the
    // edit form. Handle each navigation once instead and leave it in place.
    handledEditLocationKey.current = location.key
    loadSymptomForEdit(log)
  }, [location.key, location.state, symptomLogs])

  return (
    <article className="logger-card page-card">
      <header className="logger-header">
        <div>
          <div className="section-label">
            <Droplets size={16} />
            Bowel movement logger
          </div>
        </div>
        <button
          type="button"
          className="ghost-button ghost-button--compact"
          onClick={() => setShowRecentLogs(true)}
        >
          <Clock3 size={16} /> Recent bowel logs
        </button>
      </header>

      {showRecentLogs ? (
        <RecentBowelLogsPopup
          symptomLogs={symptomLogs}
          onClose={() => setShowRecentLogs(false)}
          onEdit={(log) => {
            loadSymptomForEdit(log)
            setShowRecentLogs(false)
          }}
          onDelete={(log) => setPendingDeletion(log)}
        />
      ) : null}
      {pendingDeletion ? <ConfirmDeleteModal title="Delete bowel log?" message={`This will permanently remove the Bristol type ${pendingDeletion.bristol_type} entry.`} onCancel={() => setPendingDeletion(null)} onConfirm={() => deleteSymptom(pendingDeletion)} /> : null}

      <form className="logger-form" onSubmit={submitSymptom}>
        <label className="field">
          <span>Outtake timestamp</span>
          <div className="input-with-icon">
            <Clock3 size={16} />
            <input
              type="datetime-local"
              value={form.occurredAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  occurredAt: event.target.value,
                }))
              }
            />
          </div>
        </label>

        <div className="field">
          <span>Stool type</span>
          <div className="bristol-grid" role="radiogroup" aria-label="Bristol stool scale">
            {BRISTOL_TYPES.map(({ type, description }) => {
              const active = form.bristolType === type

              return (
                <button
                  key={type}
                  type="button"
                  className={`bristol-button ${active ? 'active' : ''}`}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      bristolType: type,
                    }))
                  }
                >
                  <span>Type</span>
                  <strong>{type}</strong>
                  <small>{description}</small>
                </button>
              )
            })}
          </div>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            placeholder="Urgency, pain, bloating, mucus, or anything worth correlating later."
            rows={5}
          />
        </label>

        <div className="logger-actions">
          {editingSymptomId ? (
            <button type="button" className="ghost-button" onClick={cancelSymptomEdit}>
              Cancel edit
            </button>
          ) : null}

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={16} className="spin" />
                Saving
              </>
            ) : (
              <>
                <Save size={16} />
                {editingSymptomId ? 'Save changes' : 'Save entry'}
              </>
            )}
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        {showLogManagement ? <section className="management-card">
          <div className="management-card__header">
            <div>
              <span className="field-title">Recent bowel logs</span>
              <p className="field-help">Open an entry to edit or delete it.</p>
            </div>
            <button
              type="button"
              className="ghost-button ghost-button--compact"
              onClick={() => setShowRecentLogs((current) => !current)}
            >
              <ChevronDown size={16} className={`collapse-icon ${showRecentLogs ? 'open' : ''}`} />
              {showRecentLogs ? 'Hide' : 'Show'}
            </button>
          </div>

          {showRecentLogs ? (
            symptomLogs.length === 0 ? (
              <div className="empty-state">No bowel logs yet.</div>
            ) : (
              <div className="management-list">
                {symptomLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="management-row">
                    <div>
                      <strong>Type {log.bristol_type}</strong>
                      <span>{format(parseISO(log.occurred_at), 'MMM d, p')}</span>
                      <p>{log.notes?.trim() || 'No notes recorded.'}</p>
                    </div>
                    <div className="management-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => loadSymptomForEdit(log)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => deleteSymptom(log)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="empty-state empty-state--compact">
              {symptomLogs.length} bowel logs hidden. Expand to review recent entries.
            </div>
          )}
        </section> : null}
      </form>

      <div className="logger-footnote">
        <Flame size={16} />
        The logger keeps timestamps explicit so you can later correlate
        symptoms against the previous 24 to 72 hours.
      </div>
    </article>
  )
}
