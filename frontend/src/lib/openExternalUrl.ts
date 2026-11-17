import { invoke } from '@tauri-apps/api/core'

export async function openExternalUrl(url: string) {
  if ('__TAURI_INTERNALS__' in window) {
    await invoke('open_external_url', { url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
