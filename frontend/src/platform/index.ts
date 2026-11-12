export type PlatformContext = {
  backendUrl: string
  isDesktop: boolean
}

const browserBackendUrl = import.meta.env.VITE_PB_URL ?? 'http://127.0.0.1:8090'

function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window
}

export function getOpenFoodFactsSearchUrl() {
  const path = '/cgi/search.pl?search_terms='
  return isTauriRuntime() ? `https://world.openfoodfacts.org${path}` : `/api/openfoodfacts${path}`
}

export async function initializePlatform(): Promise<PlatformContext> {
  if (!isTauriRuntime()) {
    return { backendUrl: browserBackendUrl, isDesktop: false }
  }

  const { initializeDesktop } = await import('./tauri')
  return initializeDesktop()
}
