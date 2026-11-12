import PocketBase from 'pocketbase'

const fallbackUrl = 'http://127.0.0.1:8090'
const pbUrl = import.meta.env.VITE_PB_URL ?? fallbackUrl

export const pb = new PocketBase(pbUrl)

export function configurePocketBase(baseUrl: string) {
  pb.baseURL = baseUrl
}

