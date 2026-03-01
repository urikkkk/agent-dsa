import type {
  NimbleSerpResult,
  NimblePdpResult,
  ParsedProduct,
} from '@agent-dsa/shared';
import { parseSize, computeUnitPrice } from './normalize.js';

export function parseSerpResults(rawData: unknown): NimbleSerpResult[] {
  if (!rawData || !Array.isArray(rawData)) return [];
  return rawData.map((item: Record<string, unknown>, index: number) => ({
    rank: (item.rank as number) || index + 1,
    title: String(item.title || item.name || ''),
    url: String(item.url || item.link || ''),
    price: item.price != null ? Number(item.price) : undefined,
    is_sponsored: Boolean(item.is_sponsored || item.sponsored || item.is_ad),
    badge: item.badge ? String(item.badge) : undefined,
    retailer_product_id: item.product_id
      ? String(item.product_id)
      : undefined,
    rating: item.rating != null ? Number(item.rating) : undefined,
    review_count:
      item.review_count != null ? Number(item.review_count) : undefined,
  }));
}

export function parsePdpResult(rawData: unknown): NimblePdpResult | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  return {
    title: String(data.title || data.name || ''),
    brand: data.brand ? String(data.brand) : undefined,
    price: Number(data.price || data.shelf_price || 0),
    promo_price:
      data.promo_price != null ? Number(data.promo_price) : undefined,
    size_raw: data.size ? String(data.size) : undefined,
    unit_price: data.unit_price != null ? Number(data.unit_price) : undefined,
    in_stock:
      data.in_stock != null
        ? Boolean(data.in_stock)
        : data.availability !== 'out_of_stock',
    rating: data.rating != null ? Number(data.rating) : undefined,
    review_count:
      data.review_count != null ? Number(data.review_count) : undefined,
    variants: Array.isArray(data.variants) ? data.variants : undefined,
    url: String(data.url || ''),
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
  const unit_price =
    pdp.unit_price ||
    (size.oz > 0 ? computeUnitPrice(pdp.price, size.oz) : 0);

  return {
    name: pdp.title,
    brand: pdp.brand || '',
    size_oz: size.oz,
    size_raw: pdp.size_raw || '',
    pack_count: size.pack_count,
    shelf_price: pdp.price,
    promo_price: pdp.promo_price,
    unit_price,
    in_stock: pdp.in_stock,
    rating: pdp.rating,
    review_count: pdp.review_count,
    source_url: sourceUrl,
    retailer_product_id: retailerProductId,
    confidence:
      pdp.price > 0 && size.oz > 0 ? 0.9 : pdp.price > 0 ? 0.7 : 0.3,
  };
}
