export const TAG_MULTIPLIERS = {
  Dairy: 1.5,
  'High-Fat': 1.4,
  FODMAP: 1.35,
  Allium: 1.35,
  Fructans: 1.35,
  'High-Histamine': 1.3,
  'processed meat': 1.25,
  Nightshade: 1.2,
  Soy: 1.2,
  Gluten: 1.2,
  'wheat flour': 1.2,
  Nut: 1.15,
  Protein: 1,
  'high-sodium': 1,
  Salted: 1,
  soup: 1,
  'Low-Risk': 0.5,
  Safe: 0.3,
}

const AUTO_TAG_RULES = [
  {
    tag: 'Dairy',
    keywords: ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'whey', 'casein', 'lactose'],
  },
  {
    tag: 'High-Fat',
    keywords: ['high fat', 'fatty', 'oil', 'fried', 'butter', 'cream', 'cheese', 'mayo', 'sausage'],
  },
  {
    tag: 'FODMAP',
    keywords: [
      'fodmap',
      'onion',
      'garlic',
      'leek',
      'shallot',
      'wheat',
      'rye',
      'barley',
      'apple',
      'pear',
      'mango',
      'honey',
      'cauliflower',
      'beans',
      'lentil',
      'chickpea',
      'pistachio',
      'cashew',
      'lactose',
    ],
  },
  {
    tag: 'Allium',
    keywords: ['onion', 'garlic', 'leek', 'shallot', 'chive', 'scallion'],
  },
  {
    tag: 'Fructans',
    keywords: ['fructan', 'onion', 'garlic', 'wheat', 'rye', 'barley', 'inulin'],
  },
  {
    tag: 'High-Histamine',
    keywords: [
      'fermented',
      'aged',
      'cured',
      'smoked',
      'pickled',
      'vinegar',
      'soy sauce',
      'miso',
      'kombucha',
      'salami',
      'pepperoni',
      'wine',
      'beer',
    ],
  },
  {
    tag: 'processed meat',
    keywords: ['bacon', 'ham', 'sausage', 'salami', 'pepperoni', 'hot dog', 'deli', 'processed meat'],
  },
  {
    tag: 'Nightshade',
    keywords: ['tomato', 'potato', 'pepper', 'paprika', 'chili', 'chilli', 'aubergine', 'eggplant'],
  },
  {
    tag: 'Soy',
    keywords: ['soy', 'soya', 'tofu', 'tempeh', 'edamame', 'soybean'],
  },
  {
    tag: 'Gluten',
    keywords: ['gluten', 'wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'noodle'],
  },
  {
    tag: 'wheat flour',
    keywords: ['wheat flour', 'flour', 'enriched wheat flour', 'plain flour', 'self-raising flour'],
  },
  {
    tag: 'Nut',
    keywords: ['nut', 'almond', 'walnut', 'cashew', 'hazelnut', 'pistachio', 'peanut', 'pecan'],
  },
  {
    tag: 'high-sodium',
    keywords: ['high sodium', 'salted', 'salty', 'sodium', 'broth', 'stock', 'instant noodle', 'cured'],
  },
  {
    tag: 'Protein',
    keywords: ['protein', 'protein bar', 'protein shake', 'whey', 'pea protein', 'soy protein'],
  },
]

const normalizeText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const collectSources = (product) =>
  [
    product?.product_name,
    product?.generic_name,
    product?.categories,
    product?.ingredients_text,
    product?.ingredients_text_en,
    ...(Array.isArray(product?.categories_tags) ? product.categories_tags : []),
    ...(Array.isArray(product?.ingredients_tags) ? product.ingredients_tags : []),
  ].filter(Boolean)

export const mapSourceTextToTags = (sourceText) => {
  const sources = Array.isArray(sourceText) ? sourceText : [sourceText]
  const normalizedSources = sources.map(normalizeText).filter(Boolean)
  const matchedTags = new Set()

  for (const rule of AUTO_TAG_RULES) {
    const matched = normalizedSources.some((source) =>
      rule.keywords.some((keyword) => source.includes(normalizeText(keyword))),
    )

    if (matched) {
      matchedTags.add(rule.tag)
    }
  }

  return [...matchedTags]
}

export const mapOpenFoodFactsProductToTags = (product) =>
  mapSourceTextToTags(collectSources(product))

export const mapTagsToMultipliers = (tags) =>
  (Array.isArray(tags) ? tags : [tags])
    .map((tag) => {
      const normalizedTag = normalizeText(tag)
      return {
        tag,
        multiplier:
          TAG_MULTIPLIERS[
            Object.keys(TAG_MULTIPLIERS).find((candidate) => normalizeText(candidate) === normalizedTag) ??
              ''
          ] ?? 1,
      }
    })
    .filter((entry) => entry.tag)
