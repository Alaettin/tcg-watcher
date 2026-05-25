import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export const listingsRouter = Router();

listingsRouter.get("/listings", async (req, res, next) => {
  try {
    const where: Prisma.ListingWhereInput = {};
    if (typeof req.query.productId === "string" && req.query.productId.length > 0) {
      where.productId = req.query.productId;
    }
    if (typeof req.query.shopId === "string" && req.query.shopId.length > 0) {
      where.shopId = req.query.shopId;
    }
    const listings = await prisma.listing.findMany({
      where,
      orderBy: { seenAt: "desc" },
      take: Math.min(Number(req.query.limit ?? 100), 500),
    });
    res.json(listings);
  } catch (err) {
    next(err);
  }
});
