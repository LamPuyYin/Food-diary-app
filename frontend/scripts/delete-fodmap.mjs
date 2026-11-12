import PocketBase from 'pocketbase'

const baseUrl = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const shouldDelete = process.argv.includes('--confirm')
const pb = new PocketBase(baseUrl)

const records = await pb.collection('ingredients').getFullList({
  filter: 'createdBy = "fodmapLibrary"',
  fields: 'id,name,createdBy',
})

console.log(`Found ${records.length} fodmapLibrary ingredient(s) at ${baseUrl}.`)

if (!shouldDelete) {
  console.log('Preview only: no records were deleted.')
  console.log('Run `npm run delete:fodmap -- --confirm` to delete these records.')
  process.exit(0)
}

for (const record of records) {
  await pb.collection('ingredients').delete(record.id)
}

console.log(`Deleted ${records.length} fodmapLibrary ingredient(s). User ingredients were not touched.`)
