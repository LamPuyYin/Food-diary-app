import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'

type ConfirmDeleteModalProps = {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  busy?: boolean
}

export function ConfirmDeleteModal({ title, message, onCancel, onConfirm, busy = false }: ConfirmDeleteModalProps) {
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section className="warning-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-warning-title">
        <header className="warning-modal__header">
          <div className="warning-modal__icon"><AlertTriangle size={20} /></div>
          <button type="button" className="ghost-button ghost-button--compact" onClick={onCancel} disabled={busy} aria-label="Close warning"><X size={18} /></button>
        </header>
        <h2 id="delete-warning-title">{title}</h2>
        <p>{message}</p>
        <div className="logger-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="danger-button" onClick={() => void onConfirm()} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
