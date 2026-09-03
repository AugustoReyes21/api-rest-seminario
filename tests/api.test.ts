import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const body = { customerName: "Ana López", items: [{ productId: "P-100", quantity: 2, unitPrice: 25.5 }] };

describe("Orders API", () => {
  let app: FastifyInstance;
  beforeEach(() => { app = buildApp(); });
  afterEach(async () => { await app.close(); });

  it("crea, consulta, modifica y cancela un pedido", async () => {
    const created = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "test-key-001" }, payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toMatch(/^\/orders\//);
    const order = created.json();
    expect(order.total).toBe(51);
    expect((await app.inject({ method: "GET", url: `/orders/${order.id}` })).statusCode).toBe(200);
    const patched = await app.inject({ method: "PATCH", url: `/orders/${order.id}`, payload: { status: "confirmed" } });
    expect(patched.json().status).toBe("confirmed");
    expect((await app.inject({ method: "DELETE", url: `/orders/${order.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/orders/${order.id}` })).statusCode).toBe(204);
  });

  it("implementa los tres casos de idempotencia", async () => {
    const first = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "same-key-001" }, payload: body });
    const replay = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "same-key-001" }, payload: body });
    const conflict = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "same-key-001" }, payload: { ...body, customerName: "Otra persona" } });
    const distinct = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "other-key-002" }, payload: body });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().id).toBe(first.json().id);
    expect(conflict.statusCode).toBe(409);
    expect(distinct.statusCode).toBe(201);
    expect(distinct.json().id).not.toBe(first.json().id);
  });

  it("valida entradas y devuelve errores consistentes", async () => {
    const response = await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": "bad-data-001" }, payload: { customerName: "A", items: [] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(response.json().error.requestId).toBeTruthy();
  });

  it("filtra, ordena y pagina la colección", async () => {
    for (const [key, customerName, price] of [["list-key-001", "Bruno", 30], ["list-key-002", "Ana", 10], ["list-key-003", "Ana María", 20]] as const) {
      await app.inject({ method: "POST", url: "/orders", headers: { "idempotency-key": key }, payload: { customerName, items: [{ productId: "P-1", quantity: 1, unitPrice: price }] } });
    }
    const response = await app.inject({ method: "GET", url: "/orders?status=pending&customerName=ana&sort=total&order=desc&page=1&pageSize=1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].customerName).toBe("Ana María");
    expect(response.json().pagination).toMatchObject({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
  });
});
