import { EventEmitter } from "node:events";
import type { DetectedEvent } from "../detector/eventDetector.js";

class TypedEventBus extends EventEmitter {
  emitDetected(event: DetectedEvent): boolean {
    return this.emit("event", event);
  }

  onDetected(listener: (event: DetectedEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);
