/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const foodLogs = app.findCollectionByNameOrId("food_logs")
  const dishes = app.findCollectionByNameOrId("dishes")

  foodLogs.fields.add(new RelationField({
    name: "dishes",
    collectionId: dishes.id,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 99
  }))

  return app.save(foodLogs)
}, (app) => {
  const foodLogs = app.findCollectionByNameOrId("food_logs")
  foodLogs.fields.removeByName("dishes")
  return app.save(foodLogs)
})
