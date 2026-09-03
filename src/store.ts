import type { Order } from "./types.js";

interface IdempotencyRecord {
  fingerprint: string;
  order: Order;
}

export class OrderStore {
  readonly orders = new Map<string, Order>();
  readonly idempotency = new Map<string, IdempotencyRecord>();

  reset(): void {
    this.orders.clear();
    this.idempotency.clear();
  }
}
