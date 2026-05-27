export type EventType =
  | "NEW_LISTING"
  | "RESTOCK"
  | "PRICE_DROP"
  | "RESALE_DEAL"
  | "WENT_OUT_OF_STOCK";

export type ListingStatus = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN";

export interface Shop {
  id: string;
  displayName: string;
  baseUrl: string;
  adapterType: string;
  family: ShopFamily;
  enabled: boolean;
  pollIntervalSeconds: number;
  dropDayIntervalSeconds: number;
  setListId: string | null;
  lastSuccessfulRun: string | null;
  eventCount24h: number;
  online: boolean;
}

export interface Product {
  id: string;
  displayName: string;
  category: string;
  expectedReleaseDate: string | null;
  uvpEur: number | null;
  uvpToleranceEur: number;
  searchTerms: string[];
  negativeTerms: string[];
  ean: string | null;
  minResalePriceEur: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventListingSummary {
  shopId: string;
  productId: string;
  title: string;
  url: string;
  priceEur: number;
  status: ListingStatus;
}

export interface AppEvent {
  id: string;
  listingId: string;
  type: EventType;
  detail: Record<string, unknown>;
  notifiedAt: string | null;
  createdAt: string;
  listing: EventListingSummary;
}

export interface DetectedEvent {
  type: EventType;
  productId: string;
  shopId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  detail: Record<string, unknown>;
}

export interface Variant {
  id: string;
  setId: string;
  kind: string;
  displayName: string;
  uvpEur: number | null;
  uvpToleranceEur: number;
  ean: string | null;
}

export interface SetEntry {
  id: string;
  name: string;
  shortCode: string | null;
  description: string | null;
  releaseDate: string | null;
  language: string;
  era: string | null;
  searchTerms: string[];
  negativeTerms: string[];
  isPreset: boolean;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

export interface SetList {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  itemCount: number;
  shopCount?: number;
}

export interface SetListDetail extends SetList {
  setIds: string[];
  sets: Array<{ id: string; name: string; era: string | null; releaseDate: string | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineDeal {
  id: string;
  source: string;
  sourceDealId: string;
  retailerId: string;
  retailerName: string;
  title: string;
  description: string | null;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  priceEur: number | null;
  originalPriceEur: number | null;
  validFrom: string;
  validUntil: string;
  sourceUrl: string | null;
  postalCode: string | null;
  storeName: string | null;
  storeAddress: string | null;
  storeCity: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface OfflineRetailer {
  id: string;
  displayName: string;
  logoUrl: string | null;
  activeDealsCount: number;
}

export interface SetPreset {
  id: string;
  name: string;
  shortCode: string | null;
  era: string | null;
  active: boolean;
  releaseDate: string | null;
}

export interface Listing {
  id: string;
  productId: string;
  shopId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  currency: string;
  status: ListingStatus;
  seenAt: string;
}

export type ShopFamily = "fast" | "slow";

export interface CurrentlyRunning {
  shopId: string;
  displayName: string;
  adapterType: string;
  family: ShopFamily;
  startedAt: string | null;
  elapsedMs: number;
}

export interface RecentRun {
  shopId: string;
  displayName: string;
  adapterType: string;
  family: ShopFamily;
  completedAt: string | null;
  durationMs: number;
  listingsFound: number;
  matched: number;
  events: number;
  newListings: number;
  restocks: number;
  online: boolean;
}

export interface CardmarketPrice {
  idProduct: number;
  idCategory: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  avgHolo: number | null;
  lowHolo: number | null;
  trendHolo: number | null;
  avg1Holo: number | null;
  avg7Holo: number | null;
  avg30Holo: number | null;
  importedAt: string;
  updatedAt: string;
}

export interface CardmarketProduct {
  idProduct: number;
  name: string;
  idCategory: number;
  categoryName: string;
  idExpansion: number;
  idMetacard: number;
  dateAdded: string | null;
  importedAt: string;
  updatedAt: string;
  price: CardmarketPrice | null;
}

export interface CardmarketCategory {
  idCategory: number;
  categoryName: string;
  productCount: number;
}

export interface CardmarketExpansion {
  idExpansion: number;
  productCount: number;
  name: string | null;
  language: string | null;
}

// ---- Phase 1 + 2 (cm.md) -----------------------------------------------------

export type CmRecommendation = "GREEN" | "AMBER" | "RED" | "NEUTRAL";

export type CmMovementClass =
  | "accelerating"
  | "stable_uptrend"
  | "stagnating_peak"
  | "correction_in_uptrend"
  | "turning_up"
  | "sideways"
  | "turning_down"
  | "bounce_in_downtrend"
  | "bottoming"
  | "stable_downtrend"
  | "capitulation"
  | "unknown";

export interface CardmarketSignalSummary {
  idProduct: number;
  snapshotDate: string;
  lScore: number | null;
  mScore: number | null;
  delta7: number | null;
  delta30: number | null;
  movementClass: CmMovementClass | null;
  recommendation: CmRecommendation;
  headline: string;
  reasoningLines: string[];
  sampleQuality: number;
  product: {
    idProduct: number;
    name: string;
    idCategory: number;
    categoryName: string;
    idExpansion: number;
  };
  price: {
    trend: number | null;
    low: number | null;
    avg: number | null;
  };
}

export interface CardmarketSignalDetail {
  idProduct: number;
  snapshotDate: string;
  lScore: number | null;
  mScore: number | null;
  delta7: number | null;
  delta30: number | null;
  movementClass: CmMovementClass | null;
  recommendation: CmRecommendation;
  headline: string;
  reasoningLines: string[];
  sampleQuality: number;
}

export interface CardmarketSetContext {
  idExpansion: number;
  productCount: number;
  medianL: number | null;
  medianDelta7: number | null;
  volatilityDelta7: number | null;
  name: string | null;
  language: string | null;
}

export interface CardmarketSignalListResponse {
  results: CardmarketSignalSummary[];
  total: number;
  snapshotDate: string | null;
  offset: number;
  limit: number;
  tab?: "risers" | "fallers" | "deals" | "volatile";
}

export interface CardmarketHistoryPoint {
  date: string;
  low: number | null;
  avg: number | null;
  trend: number | null;
}

export interface CardmarketHistoryResponse {
  range: "7d" | "30d" | "90d" | "all";
  points: CardmarketHistoryPoint[];
}

export interface CardmarketProductSignalResponse {
  product: CardmarketProduct;
  signal: CardmarketSignalDetail | null;
  setContext: CardmarketSetContext | null;
}

export interface CardmarketSetSignalResponse {
  set: CardmarketSetContext | null;
  products: CardmarketSignalSummary[];
}

export interface CardmarketSyncLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  productsCount: number | null;
  snapshotsCount: number | null;
  signalsCount: number | null;
  expansionsCount: number | null;
  watchlistAlertsCount: number | null;
  status: "running" | "ok" | "failed";
  errorMsg: string | null;
  durationMs: number | null;
}

// ---- Phase 3 — Watchlist (cm.md §5) -----------------------------------------

export interface CardmarketWatchlistEntry {
  id: string;
  idProduct: number;
  note: string | null;
  alertBelowTrend: number | null;
  alertAboveTrend: number | null;
  alertOnSignalFlip: boolean;
  addedAt: string;
  updatedAt: string;
  lastAlertSentAt: string | null;
  lastNotifiedRecommendation: CmRecommendation | null;
}

export interface CardmarketWatchlistItem extends CardmarketWatchlistEntry {
  product: {
    idProduct: number;
    name: string;
    idCategory: number;
    categoryName: string;
    idExpansion: number;
  };
  price: { trend: number | null; low: number | null; avg: number | null };
  signal: {
    recommendation: CmRecommendation;
    headline: string;
    delta7: number | null;
    lScore: number | null;
    mScore: number | null;
  } | null;
}

export interface CardmarketWatchlistListResponse {
  results: CardmarketWatchlistItem[];
  total: number;
}

export interface CardmarketWatchlistUpsertBody {
  idProduct: number;
  note?: string | null;
  alertBelowTrend?: number | null;
  alertAboveTrend?: number | null;
  alertOnSignalFlip?: boolean;
}

export interface CardmarketDashboardResponse {
  snapshotDate: string | null;
  breadthIndex: number | null;
  breadthIndex7dAgo: number | null;
  breadthIndexSparkline: Array<{ date: string; breadthIndex: number | null }>;
  highlights: {
    topRiser: CardmarketSignalSummary | null;
    topFaller: CardmarketSignalSummary | null;
    biggestDeal: CardmarketSignalSummary | null;
  };
  topGreen: CardmarketSignalSummary[];
  lastSyncLog: CardmarketSyncLog | null;
}

export interface CardmarketProductList {
  results: CardmarketProduct[];
  total: number;
  offset: number;
  limit: number;
}

export interface CardmarketSyncStatus {
  id: string;
  productsLastSync: string | null;
  productsLastSourceAt: string | null;
  productsRecordCount: number | null;
  pricesLastSync: string | null;
  pricesLastSourceAt: string | null;
  pricesRecordCount: number | null;
  lastError: string | null;
  updatedAt: string;
}

export interface HeartbeatSnapshot {
  shops: Array<{
    id: string;
    displayName: string;
    lastSuccessfulRun: string | null;
    enabled: boolean;
  }>;
  enabledCount: number;
  totalShopCount: number;
  onlineCount: number;
  offlineCount: number;
  listingCount: number;
  configuredShopCount: number;
  unconfiguredShopCount: number;
  totalSetCount: number;
  events24h: Array<{ type: EventType; count: number }>;
  totalEvents24h: number;
  currentlyRunning: CurrentlyRunning[];
  recentRuns: RecentRun[];
}
