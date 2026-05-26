export interface OfflineRawDeal {
  sourceDealId: string;
  retailerId: string;         // muss zu OfflineRetailer.id passen (z.B. "kaufland")
  title: string;
  description?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  priceEur?: number;
  originalPriceEur?: number;
  validFrom: Date;
  validUntil: Date;
  sourceUrl?: string;
  postalCode?: string;
  storeName?: string;
  storeAddress?: string;
  storeCity?: string;
  storeLat?: number;
  storeLng?: number;
}

export interface OfflineAdapter {
  source: string;             // "marktguru" | "bonial"
  search(queries: string[], postalCodes: string[]): Promise<OfflineRawDeal[]>;
}
