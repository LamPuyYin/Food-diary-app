// Diagnostics only. Keep this hook non-invasive so it cannot change validation.
onRecordCreateRequest((e) => {
  try {
    const info = e.requestInfo()
    console.log('[food_logs] create request', JSON.stringify({
      method: info.method,
      body: info.body,
    }))
  } catch (error) {
    console.log('[food_logs] create request logging failed', String(error))
  }

  e.next()
}, 'food_logs')
