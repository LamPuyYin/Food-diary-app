import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const sourcePath = path.join(projectRoot, 'fodmap.json')
const outputPath = path.join(projectRoot, 'fodmap.filtered.json')

// These markers identify packaged products, supplements, meal-delivery menus,
// or named manufacturers rather than generic ingredients.
const brandMarkers = [
  'prepared meal delivery',
  'field doctor', 'we feed you', 'modifyhealth', 'dineamic', 'gut feelings',
  'froyda', 'arancini 4 all', 'bakers delight', "cob's bread", "brumby's bakery",
  'schär', 'schar', "kellogg's", 'sanitarium', 'so good', 'a2 milk', 'zespri',
  'webber naturals', 'regular girl', 'sunfiber', 'k-fibre', 'kfibre', 'fibre4',
  'fibre sense', 'fibersol', 'fibersym', 'novelose', 'nutriose', 'omni-logic',
  'fodzyme', 'visbiome', 'arise', 'elementall', 'enterade', 'ceralyte',
  'cerasport', 'indus biotech', 'bioclinic naturals', 'natural factors',
  'three arrows nutra', 'tomorrow\'s nutrition', 'taiyo', 'manildra', 'ingredion',
  'roquette', 'mgp ingredients', 'biospringer', 'h.u.m.', 'humm nutrition',
]

const hasTrademark = (name) => /[®™]/u.test(name)
const hasBrandMarker = (name) => {
  const normalized = name.toLocaleLowerCase()
  return brandMarkers.some((marker) => normalized.includes(marker))
}

const isExcluded = (food) => {
  const name = String(food.name ?? '').trim()
  return {
    name,
    reasons: [
      name.length > 80 ? 'length-over-80' : null,
      hasTrademark(name) ? 'trademark-symbol' : null,
      hasBrandMarker(name) ? 'brand-marker' : null,
    ].filter(Boolean),
  }
}

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
const foods = Array.isArray(source.foods) ? source.foods : []
const kept = []
const excluded = []

for (const food of foods) {
  const result = isExcluded(food)
  if (result.reasons.length > 0) excluded.push({ name: result.name, reasons: result.reasons })
  else kept.push(food)
}

const output = {
  ...source,
  foods: kept,
  filter: {
    generatedAt: new Date().toISOString(),
    rules: [
      'Exclude names longer than 80 characters.',
      'Exclude names containing the registered/trademark symbols ® or ™.',
      'Exclude names containing known packaged-product, manufacturer, supplement, or meal-provider markers.',
    ],
    sourceCount: foods.length,
    includedCount: kept.length,
    excludedCount: excluded.length,
    excluded,
  },
}

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Wrote ${kept.length} foods to ${outputPath}. Excluded ${excluded.length}.`)
console.log('Review fodmap.filtered.json before using the importer.')

