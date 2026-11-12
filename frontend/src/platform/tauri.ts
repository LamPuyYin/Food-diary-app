import { invoke } from '@tauri-apps/api/core'
import type { PlatformContext } from './index'

export async function initializeDesktop(): Promise<PlatformContext> {
  const backendUrl = await invoke<string>('initialize_backend')
  return { backendUrl, isDesktop: true }
}
