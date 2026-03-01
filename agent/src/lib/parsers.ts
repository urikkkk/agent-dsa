import type {
  NimbleSerpResult,
  NimblePdpResult,
  ParsedProduct,
} from '@agent-dsa/shared';
import { parseSize, computeUnitPrice } from './normalize.js';

/**
 * Parse SERP results from Nimble WSA agent response.
 * WSA agents return parsed_items with fields like:
 * product_name, asin, price, rating, review_count, product_url, etc.
 */
export function parseSerpResults(rawData: unknown): NimbleSerpResult[] {
  if (!rawData || !Array.isArray(rawData)) return [];
  return rawData.map((item: Record<string, unknown>, index: number) => ({
    rank: (item.position as number) || (item.rank as number) || index + 1,
    title: String(item.product_name || item.title || item.name || ''),
    url: String(item.product_url || item.url || item.link || ''),
    price: item.price != null
      ? Number(item.price)
      : item.product_price != null
        ? Number(item.product_price)
        : undefined,
    is_sponsored: Boolean(item.is_sponsored || item.sponsored || item.is_ad),
    badge: item.badge
      ? String(item.badge)
      : item.amazons_choice
        ? 'amazons_choice'
        : undefined,
    retailer_product_id: item.asin
      ? String(item.asin)
      : item.product_id
        ? String(item.product_id)
        : undefined,
    rating: item.rating != null
      ? Number(item.rating)
      : item.product_rating != null
        ? Number(item.product_rating)
        : undefined,
    review_count: item.review_count != null
      ? Number(item.review_count)
      : item.product_reviews_count != null
        ? Number(item.product_reviews_count)
        : undefined,
  }));
}

/**
 * Parse PDP result from Nimble WSA agent response.
 * Amazon PDP returns fields like: product_title, web_price, brand, availability, etc.
 * Walmart PDP returns similar but with different field names.
 */
export function parsePdpResult(rawData: unknown): NimblePdpResult | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  return {
    title: String(data.product_title || data.title || data.name || ''),
    brand: data.brand ? String(data.brand) : undefined,
    price:
      data.web_price != null ? Number(data.web_price)
      : data.price != null ? Number(data.price)
      : data.shelf_price != null ? Number(data.shelf_price)
      : data.product_price != null ? Number(data.product_price)
      : null,
    promo_price:
      data.promo_price != null
        ? Number(data.promo_price)
        : data.list_price != null && Number(data.list_price) > Number(data.web_price || data.price || 0)
          ? Number(data.web_price || data.price)
          : undefined,
    size_raw: data.pack_size
      ? String(data.pack_size)
      : data.size
        ? String(data.size)
        : data.unit_of_measure
          ? `${data.unit_of_measure_quantity || ''} ${data.unit_of_measure}`
          : undefined,
    unit_price: data.unit_price != null
      ? Number(data.unit_price)
      : data.price_per_unit != null
        ? Number(data.price_per_unit)
        : undefined,
    in_stock:
      data.availability != null
        ? Boolean(data.availability)
        : data.in_stock != null
          ? Boolean(data.in_stock)
          : data.product_out_of_stock != null
            ? !Boolean(data.product_out_of_stock)
            : true,
    rating: data.average_of_reviews != null
      ? Number(data.average_of_reviews)
      : data.rating != null
        ? Number(data.rating)
        : data.product_rating != null
          ? Number(data.product_rating)
          : undefined,
    review_count: data.number_of_reviews != null
      ? Number(data.number_of_reviews)
      : data.review_count != null
        ? Number(data.review_count)
        : data.product_reviews_count != null
          ? Number(data.product_reviews_count)
          : undefined,
    variants: Array.isArray(data.variants) ? data.variants : undefined,
    url: String(data.product_url || data.url || ''),
  };
}

export function pdpToProduct(
  pdp: NimblePdpResult,
  sourceUrl: string,
  retailerProductId?: string
): ParsedProduct {
  const size = pdp.size_raw
    ? parseSize(pdp.size_raw)
    : { oz: 0, raw: '', pack_count: 1 };
  const price = pdp.price ?? 0;
  const unit_price =
    pdp.unit_price ||
    (size.oz > 0 ? computeUnitPrice(price, size.oz) : 0);

  return {
    name: pdp.title,
    brand: pdp.brand || '',
    size_oz: size.oz,
    size_raw: pdp.size_raw || '',
    pack_count: size.pack_count,
    shelf_price: price,
    promo_price: pdp.promo_price,
    unit_price,
    in_stock: pdp.in_stock,
    rating: pdp.rating,
    review_count: pdp.review_count,
    source_url: sourceUrl,
    retailer_product_id: retailerProductId,
    confidence:
      price > 0 && size.oz > 0 ? 0.9 : price > 0 ? 0.7 : 0.3,
  };
}
