import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { type MouseEvent } from 'react'
import { openExternalUrl } from '../lib/openExternalUrl'

type SetupRequiredModalProps = {
  backendUrl: string
  error: string | null
  isChecking: boolean
  onCheckAgain: () => void
}

export function SetupRequiredModal({ backendUrl, error, isChecking, onCheckAgain }: SetupRequiredModalProps) {
  async function handleOpenDashboard(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    try {
      await openExternalUrl(`${backendUrl}/_/`)
    } catch (openError) {
      console.error(openError)
    }
  }

  return (
    <div className="modal-backdrop registration-backdrop" role="presentation">
      <section className="warning-modal setup-required-modal" role="dialog" aria-modal="true" aria-labelledby="setup-required-title">
        <div className="warning-modal__header">
          <div className="warning-modal__icon" aria-hidden="true">
            <AlertTriangle size={24} />
          </div>
        </div>
        <div>
          <p className="eyebrow">One-time setup</p>
          <h2 id="setup-required-title">Create your PocketBase administrator</h2>
        </div>
        <p>
          Before using the diary, open PocketBase and create the first administrator account in the dashboard. This account stays inside your local database.
        </p>
        {error ? <div className="alert" role="alert">{error}</div> : null}
        <div className="setup-required-modal__actions">
          <a className="primary-button" href={`${backendUrl}/_/`} target="_blank" rel="noreferrer" onClick={handleOpenDashboard}>
            <ExternalLink size={18} />
            Open PocketBase dashboard
          </a>
          <button className="ghost-button" type="button" onClick={onCheckAgain} disabled={isChecking}>
            <RefreshCw size={18} />
            {isChecking ? 'Checking…' : 'I have registered — check again'}
          </button>
        </div>
      </section>
    </div>
  )
}
