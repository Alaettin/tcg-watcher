import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

interface RetailerSeed {
  id: string;
  displayName: string;
}

const RETAILERS: RetailerSeed[] = [
  // Supermärkte / Discounter
  { id: "rewe", displayName: "REWE" },
  { id: "edeka", displayName: "EDEKA" },
  { id: "kaufland", displayName: "Kaufland" },
  { id: "penny", displayName: "Penny" },
  { id: "lidl", displayName: "Lidl" },
  { id: "aldi-sued", displayName: "Aldi Süd" },
  { id: "aldi-nord", displayName: "Aldi Nord" },
  { id: "netto", displayName: "Netto Marken-Discount" },
  { id: "real", displayName: "Real" },
  { id: "globus", displayName: "Globus" },
  { id: "famila", displayName: "Famila" },
  { id: "marktkauf", displayName: "Marktkauf" },
  // Drogerie
  { id: "dm", displayName: "dm" },
  { id: "rossmann", displayName: "Rossmann" },
  { id: "mueller", displayName: "Müller" },
  { id: "budni", displayName: "Budni" },
  // Spielwaren / Elektronik
  { id: "galeria", displayName: "Galeria" },
  { id: "mediamarkt", displayName: "MediaMarkt" },
  { id: "saturn", displayName: "Saturn" },
  { id: "smyths-toys", displayName: "Smyths Toys" },
  // Buchhandel
  { id: "thalia", displayName: "Thalia" },
  { id: "hugendubel", displayName: "Hugendubel" },
  // Baumärkte (selten Pokemon, aber komplett)
  { id: "toom", displayName: "toom Baumarkt" },
  { id: "obi", displayName: "OBI" },
  { id: "hornbach", displayName: "Hornbach" },
  { id: "bauhaus", displayName: "Bauhaus" },
  // IKEA
  { id: "ikea", displayName: "IKEA" },
];

export async function seedOfflineRetailers(): Promise<void> {
  for (const r of RETAILERS) {
    await prisma.offlineRetailer.upsert({
      where: { id: r.id },
      create: r,
      update: { displayName: r.displayName },
    });
  }
  logger.info({ count: RETAILERS.length }, "offline retailers seeded");
}
