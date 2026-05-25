import { Router } from "express";
import { collectHeartbeat } from "../../notify/heartbeat.js";

export const heartbeatRouter = Router();

heartbeatRouter.get("/heartbeat", async (_req, res, next) => {
  try {
    const snap = await collectHeartbeat();
    res.json(snap);
  } catch (err) {
    next(err);
  }
});
