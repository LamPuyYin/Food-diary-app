import { pb } from './pocketbase'

type FodmapFood = {
  name?: string
  fodmaps?: Record<string, number | string>
}

type FodmapExport = { foods?: FodmapFood[] }

const fodmapLabels: Record<string, string> = {
  fructose: 'Fructose',
  lactose: 'Lactose',
  fructans: 'Fructan',
  gos: 'GOS',
  sorbitol: 'Sorbitol',
  mannitol: 'Mannitol',
}

const levelLabels: Record<number, string> = { 1: 'Low', 2: 'Moderate', 3: 'High' }

function tagsFor(food: FodmapFood) {
  const levels = Object.values(food.fodmaps ?? {})
    .map(Number)
    .filter((level) => level >= 1 && level <= 3)
  const level = levels.includes(3) ? 3 : levels.includes(2) ? 2 : levels.includes(1) ? 1 : 0
  if (!level) return []

  const tags = [`${levelLabels[level]}-FODMAP`]
  if (level === 1) return tags

  for (const [key, value] of Object.entries(food.fodmaps ?? {})) {
    const fodmapLevel = Number(value)
    const label = fodmapLabels[key]
    if (label && (fodmapLevel === 2 || fodmapLevel === 3)) {
      tags.push(`${levelLabels[fodmapLevel]}-${label}`)
    }
  }
  return tags
}

export async function seedFodmapLibrary() {
  const response = await fetch('/fodmap.filtered.json')
  if (!response.ok) throw new Error(`Could not load the bundled FODMAP library (${response.status}).`)
  const source = (await response.json()) as FodmapExport
  const records = Array.from(new Map(
    (source.foods ?? [])
      .map((food) => ({ name: String(food.name ?? '').trim(), tags: tagsFor(food), createdBy: 'fodmapLibrary' }))
      .filter((food) => food.name && food.tags.length > 0)
      .map((food) => [food.name, food] as const),
  ).values())

  const existing = await pb.collection('ingredients').getFullList(500, {
    filter: 'createdBy = "fodmapLibrary"',
    fields: 'id,name',
    // This request intentionally runs alongside the app's initial ingredient
    // load. Do not let PocketBase auto-cancel it as a duplicate request.
    requestKey: null,
  })
  if (existing.length === records.length) return

  const existingByName = new Map(existing.map((record) => [String(record.name), record.id]))
  for (let index = 0; index < records.length; index += 25) {
    await Promise.all(records.slice(index, index + 25).map((record) => {
      const existingId = existingByName.get(record.name)
      return existingId
        ? pb.collection('ingredients').update(existingId, { tags: record.tags, createdBy: record.createdBy }, { requestKey: null })
        : pb.collection('ingredients').create(record, { requestKey: null })
    }))
  }
}
