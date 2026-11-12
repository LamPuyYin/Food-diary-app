import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PocketBase from 'pocketbase'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const sourcePath = path.join(projectRoot, 'fodmap.filtered.json')
const baseUrl = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const shouldUpload = process.argv.includes('--upload')

const fodmapLabels = {
  fructose: 'Fructose',
  lactose: 'Lactose',
  fructans: 'Fructan',
  gos: 'GOS',
  sorbitol: 'Sorbitol',
  mannitol: 'Mannitol',
}

const levelLabels = { 1: 'Low', 2: 'Moderate', 3: 'High' }

const getLevel = (fodmaps) => {
  const levels = Object.values(fodmaps ?? {})
    .map(Number)
    .filter((level) => level >= 1 && level <= 3)

  if (levels.length === 0) return null
  if (levels.includes(3)) return 3
  if (levels.includes(2)) return 2
  return 1
}

const toTags = (food) => {
  const level = getLevel(food.fodmaps)
  if (!level) return []

  const tags = [`${levelLabels[level]}-FODMAP`]

  // A completely low profile needs no redundant low-* tags.
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

const escapeFilterValue = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')

try {
  await fs.access(sourcePath)
} catch {
  console.error('fodmap.filtered.json is missing. Run `npm run prepare:fodmap` first.')
  process.exit(1)
}

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
const foods = Array.isArray(source.foods) ? source.foods : []
const pb = new PocketBase(baseUrl)

let created = 0
let updated = 0
let skipped = 0

for (const food of foods) {
  const name = String(food.name ?? '').trim()
  const tags = toTags(food)
  if (!name || tags.length === 0) {
    skipped += 1
    continue
  }

  const payload = { name, tags, createdBy: 'fodmapLibrary' }
  if (!shouldUpload) continue

  let existing
  try {
    existing = await pb.collection('ingredients').getFirstListItem(`name = "${escapeFilterValue(name)}"`)
  } catch (error) {
    if (error?.status !== 404) throw error
  }

  if (existing) {
    await pb.collection('ingredients').update(existing.id, payload)
    updated += 1
  } else {
    await pb.collection('ingredients').create(payload)
    created += 1
  }
}

if (shouldUpload) {
  console.log(`Uploaded ${foods.length} reviewed FODMAP foods into ${baseUrl}. Created: ${created}; updated: ${updated}; skipped: ${skipped}.`)
} else {
  console.log(`Dry run only: ${foods.length} reviewed foods are ready. Nothing was uploaded to PocketBase.`)
  console.log('Run `npm run import:fodmap -- --upload` only after reviewing fodmap.filtered.json.')
}

