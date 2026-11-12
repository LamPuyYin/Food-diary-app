/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const dishes = app.findCollectionByNameOrId("dishes")

  // Dish records remain distinct by their PocketBase id. Only the name
  // constraint is removed so existing food-log relations stay unchanged.
  dishes.removeIndex("idx_dishes_name")

  return app.save(dishes)
}, (app) => {
  const dishes = app.findCollectionByNameOrId("dishes")

  // Reinstating this index will fail if duplicate names were created after
  // the forward migration, which is preferable to silently losing data.
  dishes.addIndex("idx_dishes_name", true, "`name` COLLATE NOCASE", "")

  return app.save(dishes)
})
