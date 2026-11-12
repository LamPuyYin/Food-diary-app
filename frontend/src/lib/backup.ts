import { extractIngredients, normalizeTags, type FoodLogRecord, type IngredientRecord, type SymptomLogRecord } from './tracker'

type DownloadedCsv = {
  filename: string
  content: string
}

const escapeCsv = (value: unknown) => {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}

const toCsv = (headers: string[], rows: Array<Array<unknown>>) =>
  [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n')

const downloadCsv = ({ filename, content }: DownloadedCsv) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadDiaryBackup = (
  ingredients: IngredientRecord[],
  foodLogs: FoodLogRecord[],
  symptomLogs: SymptomLogRecord[],
) => {
  const ingredientCsv = toCsv(
    ['id', 'name', 'tags'],
    ingredients.map((ingredient) => [
      ingredient.id,
      ingredient.name,
      normalizeTags(ingredient.tags).join(' | '),
    ]),
  )

  const mealCsv = toCsv(
    ['id', 'meal_name', 'consumed_at', 'ingredient_ids', 'ingredient_names'],
    foodLogs.map((foodLog) => {
      const linkedIngredients = extractIngredients(foodLog)
      return [
        foodLog.id,
        foodLog.meal_name,
        foodLog.consumed_at,
        (foodLog.ingredients ?? []).join(' | '),
        linkedIngredients.map((ingredient) => ingredient.name).join(' | '),
      ]
    }),
  )

  const symptomCsv = toCsv(
    ['id', 'occurred_at', 'bristol_type', 'notes'],
    symptomLogs.map((symptomLog) => [
      symptomLog.id,
      symptomLog.occurred_at,
      symptomLog.bristol_type,
      symptomLog.notes ?? '',
    ]),
  )

  downloadCsv({ filename: 'food-diary-ingredients.csv', content: ingredientCsv })
  downloadCsv({ filename: 'food-diary-meals.csv', content: mealCsv })
  downloadCsv({ filename: 'food-diary-bowel-logs.csv', content: symptomCsv })
}
