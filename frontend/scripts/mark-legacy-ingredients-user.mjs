import PocketBase from 'pocketbase'

const baseUrl = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const shouldUpdate = process.argv.includes('--confirm')
const pb = new PocketBase(baseUrl)

const records = await pb.collection('ingredients').getFullList({
  filter: 'createdBy = ""',
  fields: 'id,name,createdBy',
})

console.log(`Found ${records.length} ingredient(s) with an empty createdBy field at ${baseUrl}.`)

if (!shouldUpdate) {
  console.log('Preview only: no records were changed.')
  console.log('Run `npm run mark:legacy-user -- --confirm` to set createdBy to "user".')
  process.exit(0)
}

for (const record of records) {
  await pb.collection('ingredients').update(record.id, { createdBy: 'user' })
}

console.log(`Updated ${records.length} legacy ingredient(s) to createdBy = "user".`)
