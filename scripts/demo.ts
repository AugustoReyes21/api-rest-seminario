import type { InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";

const app = buildApp();
const payload = { customerName: "Ana López", items: [{ productId: "P-100", quantity: 2, unitPrice: 25.5 }] };

async function show(title: string, request: InjectOptions) {
  const response = await app.inject(request);
  console.log(`\n=== ${title} ===`);
  console.log(`${request.method} ${request.url} -> ${response.statusCode}`);
  if (response.headers.location) console.log(`Location: ${response.headers.location}`);
  if (response.headers["idempotency-replayed"]) console.log(`Idempotency-Replayed: ${response.headers["idempotency-replayed"]}`);
  if (response.body) console.log(JSON.stringify(response.json(), null, 2));
  return response;
}

async function main() {
  const first = await show("1. Creación exitosa", { method: "POST", url: "/orders", headers: { "idempotency-key": "demo-key-001" }, payload });
  const orderId = first.json().id;
  await show("2. Misma clave y mismos datos", { method: "POST", url: "/orders", headers: { "idempotency-key": "demo-key-001" }, payload });
  await show("3. Misma clave y datos diferentes", { method: "POST", url: "/orders", headers: { "idempotency-key": "demo-key-001" }, payload: { ...payload, customerName: "Carlos Pérez" } });
  await show("4. Clave diferente", { method: "POST", url: "/orders", headers: { "idempotency-key": "demo-key-002" }, payload });
  await show("5. Error de validación", { method: "POST", url: "/orders", headers: { "idempotency-key": "demo-bad-001" }, payload: { customerName: "A", items: [] } });
  await show("6. Consulta paginada, filtrada y ordenada", { method: "GET", url: "/orders?status=pending&customerName=ana&sort=total&order=desc&page=1&pageSize=1" });
  await show("7. Consulta individual", { method: "GET", url: `/orders/${orderId}` });
  await show("8. Actualización parcial", { method: "PATCH", url: `/orders/${orderId}`, payload: { status: "confirmed" } });
  await show("9. Cancelación", { method: "DELETE", url: `/orders/${orderId}` });
  await app.close();
}

main().catch(async (error) => {
  console.error(error);
  await app.close();
  process.exitCode = 1;
});
