// Expose only whether the local PocketBase instance has at least one
// dashboard administrator. No auth record, email address, or other field is returned.
routerAdd("GET", "/api/gutmost/setup-status", (e) => {
  const superusers = $app.findRecordsByFilter(
    "_superusers",
    "email != '__pbinstaller@example.com'",
    "",
    1,
    0,
  )
  return e.json(200, { hasRegisteredAdmin: superusers.length > 0 })
})
