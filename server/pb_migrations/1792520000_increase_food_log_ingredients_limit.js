/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const foodLogs = app.findCollectionByNameOrId("food_logs")
  const ingredients = foodLogs.fields.getByName("ingredients")

  ingredients.maxSelect = 999

  return app.save(foodLogs)
}, (app) => {
  const foodLogs = app.findCollectionByNameOrId("food_logs")
  const ingredients = foodLogs.fields.getByName("ingredients")

  ingredients.maxSelect = 10

  return app.save(foodLogs)
})
