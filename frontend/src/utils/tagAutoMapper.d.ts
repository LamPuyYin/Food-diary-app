export const TAG_MULTIPLIERS: Record<string, number>

export type OpenFoodFactsProduct = {
  code?: string
  product_name?: string
  generic_name?: string
  categories?: string
  categories_tags?: string[]
  ingredients_text?: string
  ingredients_text_en?: string
  brands?: string
  quantity?: string
  ingredients_tags?: string[]
}

export declare const mapSourceTextToTags: (sourceText: string | string[]) => string[]
export declare const mapOpenFoodFactsProductToTags: (product: OpenFoodFactsProduct) => string[]
export declare const mapTagsToMultipliers: (
  tags: string | string[],
) => { tag: string; multiplier: number }[]
