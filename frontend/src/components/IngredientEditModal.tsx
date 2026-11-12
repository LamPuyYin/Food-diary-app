import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Loader2, Save, Undo2, X } from 'lucide-react'
import type { IngredientRecord } from '../lib/tracker'

type IngredientEditModalProps = {
  ingredient: IngredientRecord
  onClose: () => void
  onSaved: (name: string, tags: string[]) => Promise<void>
  onDelete: () => void
}

export function IngredientEditModal({ ingredient, onClose, onSaved, onDelete }: IngredientEditModalProps) {
  const [name, setName] = useState(ingredient.name)
  const [tags, setTags] = useState(Array.isArray(ingredient.tags) ? ingredient.tags.join(', ') : String(ingredient.tags ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Ingredient name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSaved(cleanName, tags.split(',').map((tag) => tag.trim()).filter(Boolean))
    } catch {
      setError('Could not save the ingredient.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal((
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="dish-modal ingredient-edit-modal" role="dialog" aria-modal="true" aria-labelledby="ingredient-edit-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="dish-modal__header">
          <div><span className="section-label">Ingredient editor</span><h2 id="ingredient-edit-title">Edit ingredient</h2></div>
          <button type="button" className="ghost-button ghost-button--compact" onClick={onClose} disabled={saving} aria-label="Close"><X size={18} /></button>
        </header>
        <label className="field"><span>Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="FODMAP, dairy, gluten" /></label>
        {error ? <p className="form-message" role="alert">{error}</p> : null}
        <div className="logger-actions editor-modal-actions ingredient-edit-modal__actions">
          <button type="button" className={ingredient.isArchived ? 'ghost-button' : 'danger-button'} onClick={onDelete} disabled={saving}>
            {ingredient.isArchived ? <><Undo2 size={16} /> Restore ingredient</> : <><Archive size={16} /> Archive ingredient</>}
          </button>
          <div className="editor-modal-actions__secondary">
            <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? <><Loader2 size={16} className="spin" /> Saving</> : <><Save size={16} /> Save changes</>}</button>
          </div>
        </div>
      </section>
    </div>
  ), document.body)
}
