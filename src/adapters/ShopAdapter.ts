export type ListingAvailability = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN";

export interface RawListing {
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  status: ListingAvailability;
  rawData?: Record<string, unknown>;
}

export interface ShopAdapter {
  shopId: string;
  search(searchTerms: string[], negativeTerms?: string[]): Promise<RawListing[]>;
  isAvailable(): Promise<boolean>;
}
