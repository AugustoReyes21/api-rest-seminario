import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { z, ZodError } from "zod";
import { OrderStore } from "./store.js";
import { ORDER_STATUSES, type ApiError, type Order } from "./types.js";

const itemSchema = z.object({
  productId: z.string().trim().min(1).max(50),
  quantity: z.number().int().min(1).max(1000),
  unitPrice: z.number().positive().max(1_000_000)
}).strict();

const createOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  items: z.array(itemSchema).min(1).max(100)
}).strict();

const updateOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(100).optional(),
  status: z.enum(["pending", "confirmed"]).optional(),
  items: z.array(itemSchema).min(1).max(100).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo");

const listQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  customerName: z.string().trim().min(1).optional(),
  sort: z.enum(["createdAt", "customerName", "total"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10)
}).strict();

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validationError(error: ZodError, requestId: string): ApiError {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: "La solicitud contiene datos inválidos",
      details: error.issues.map((issue) => ({
        field: issue.path.join(".") || "request",
        message: issue.message
      })),
      requestId
    }
  };
}

function apiError(code: string, message: string, requestId: string): ApiError {
  return { error: { code, message, requestId } };
}

export function buildApp(store = new OrderStore()): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(validationError(error, request.id));
    }
    request.log.error(error);
    return reply.status(500).send(apiError("INTERNAL_ERROR", "Error interno del servidor", request.id));
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/openapi.yaml", async (_request, reply) => {
    const document = await readFile(resolve(process.cwd(), "openapi.yaml"), "utf8");
    return reply.type("application/yaml").send(document);
  });

  app.get("/openapi.json", async () => {
    const document = await readFile(resolve(process.cwd(), "openapi.yaml"), "utf8");
    return YAML.parse(document);
  });

  app.get("/orders", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let data = [...store.orders.values()];
    if (query.status) data = data.filter((order) => order.status === query.status);
    if (query.customerName) {
      const search = query.customerName.toLocaleLowerCase();
      data = data.filter((order) => order.customerName.toLocaleLowerCase().includes(search));
    }
    data.sort((a, b) => {
      const left = a[query.sort];
      const right = b[query.sort];
      const comparison = typeof left === "string"
        ? left.localeCompare(String(right))
        : Number(left) - Number(right);
      return query.order === "asc" ? comparison : -comparison;
    });
    const totalItems = data.length;
    const totalPages = Math.ceil(totalItems / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    return {
      data: data.slice(start, start + query.pageSize),
      pagination: { page: query.page, pageSize: query.pageSize, totalItems, totalPages }
    };
  });

  app.get("/orders/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const order = store.orders.get(id);
    if (!order) return reply.status(404).send(apiError("ORDER_NOT_FOUND", "Pedido no encontrado", request.id));
    return order;
  });

  app.post("/orders", async (request, reply) => {
    const keyHeader = request.headers["idempotency-key"];
    if (typeof keyHeader !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(keyHeader)) {
      return reply.status(400).send({
        error: {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Idempotency-Key es obligatorio y debe tener entre 8 y 128 caracteres válidos",
          details: [{ field: "headers.Idempotency-Key", message: "Formato inválido" }],
          requestId: request.id
        }
      });
    }
    const input = createOrderSchema.parse(request.body);
    const bodyFingerprint = fingerprint(input);
    const existing = store.idempotency.get(keyHeader);
    if (existing) {
      if (existing.fingerprint !== bodyFingerprint) {
        return reply.status(409).send(apiError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "La clave de idempotencia ya fue usada con datos diferentes",
          request.id
        ));
      }
      return reply.header("Idempotency-Replayed", "true").status(200).send(existing.order);
    }
    const now = new Date().toISOString();
    const order: Order = {
      id: randomUUID(), customerName: input.customerName, status: "pending", items: input.items,
      total: roundMoney(input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)),
      createdAt: now, updatedAt: now
    };
    store.orders.set(order.id, order);
    store.idempotency.set(keyHeader, { fingerprint: bodyFingerprint, order });
    return reply.header("Location", `/orders/${order.id}`).status(201).send(order);
  });

  app.patch("/orders/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = updateOrderSchema.parse(request.body);
    const current = store.orders.get(id);
    if (!current) return reply.status(404).send(apiError("ORDER_NOT_FOUND", "Pedido no encontrado", request.id));
    if (current.status === "cancelled") {
      return reply.status(409).send(apiError("ORDER_CANCELLED", "Un pedido cancelado no puede modificarse", request.id));
    }
    const items = input.items ?? current.items;
    const updated: Order = {
      ...current, ...input, items,
      total: roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)),
      updatedAt: new Date().toISOString()
    };
    store.orders.set(id, updated);
    return updated;
  });

  app.delete("/orders/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const current = store.orders.get(id);
    if (!current) return reply.status(404).send(apiError("ORDER_NOT_FOUND", "Pedido no encontrado", request.id));
    if (current.status === "cancelled") return reply.status(204).send();
    store.orders.set(id, { ...current, status: "cancelled", updatedAt: new Date().toISOString() });
    return reply.status(204).send();
  });

  return app;
}
