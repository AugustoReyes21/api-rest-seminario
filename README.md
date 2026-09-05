# Seminario: GraphQL y REST en TypeScript

## Entrega GraphQL: biblioteca

El servicio GraphQL está en [`graphql/`](graphql/README.md). Incluye libros relacionados con autores, esquema SDL, queries y mutations con variables, validación, errores seguros, paginación limitada y DataLoader por petición para evitar N+1.

```bash
cd graphql
npm ci
npm run dev
```

Abre **http://127.0.0.1:4000** para usar el cliente de demostración, o **http://127.0.0.1:4000/graphql** para GraphiQL.

```bash
npm test
npm run build
npm run demo
```

- [Instalación, decisiones, evidencias y comparación con REST](graphql/README.md)
- [Esquema público GraphQL](graphql/schema.graphql)
- [Operaciones con nombres y variables](graphql/examples/scenarios.json)
- [Pruebas de aceptación](graphql/tests)

La implementación REST anterior se conserva a continuación y funciona de manera independiente desde la raíz del repositorio.

## API REST de pedidos (entrega anterior)

Proyecto académico en TypeScript que demuestra semántica HTTP, validación, errores consistentes, consultas de colección, contrato OpenAPI 3.2 e idempotencia explícita en `POST`.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

No usa base de datos ni variables secretas. Los datos viven en memoria y se reinician al detener el proceso.

## Instalación y ejecución

```bash
npm install
npm run dev
```

La API queda disponible en `http://127.0.0.1:3000`. En otra terminal:

```bash
npm test
npm run demo
```

Para producción local:

```bash
npm run build
npm start
```

## Diseño HTTP

| Método y URI | Intención | Respuestas principales |
|---|---|---|
| `GET /orders` | listar y consultar la colección | `200`, `400` |
| `GET /orders/{id}` | consultar un pedido | `200`, `400`, `404` |
| `POST /orders` | crear un pedido | `201`, repetición `200`, `400`, conflicto `409` |
| `PATCH /orders/{id}` | actualización parcial | `200`, `400`, `404`, `409` |
| `DELETE /orders/{id}` | cancelar lógicamente | `204`, `400`, `404` |

Se usa `DELETE` porque la intención del cliente es retirar/cancelar el recurso. El pedido se conserva con estado `cancelled` para mantener trazabilidad. Repetir la cancelación devuelve `204`, por lo que el método conserva su propiedad idempotente. `PATCH` se eligió porque el cliente puede cambiar solo algunos campos.

## Listado

`GET /orders` admite:

- filtros `status` y `customerName` (coincidencia parcial, sin distinguir mayúsculas);
- `sort=createdAt|customerName|total` y `order=asc|desc`;
- paginación por página con `page` y `pageSize` (máximo 50).

Ejemplo:

```bash
curl "http://127.0.0.1:3000/orders?status=pending&customerName=ana&sort=total&order=desc&page=1&pageSize=1"
```

La respuesta contiene `data` y metadatos `pagination`: `page`, `pageSize`, `totalItems` y `totalPages`.

## Creación e idempotencia

`Idempotency-Key` es obligatorio en `POST /orders`, debe tener entre 8 y 128 caracteres y permite letras, números, punto, guion, guion bajo y dos puntos.

```bash
curl -i -X POST http://127.0.0.1:3000/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-order-001" \
  -d '{"customerName":"Ana López","items":[{"productId":"P-100","quantity":2,"unitPrice":25.5}]}'
```

- Primera solicitud: `201 Created`, encabezado `Location` y pedido nuevo.
- Misma clave y mismos datos: `200 OK`, mismo pedido y `Idempotency-Replayed: true`.
- Misma clave y datos diferentes: `409 Conflict`.
- Clave diferente: nuevo intento y nuevo pedido con `201 Created`.

El registro de idempotencia es atómico dentro del proceso Node y vive en memoria, suficiente para esta demostración. En producción se usaría almacenamiento compartido con restricción única, expiración y transacción.

## Validación y errores

Se validan encabezados, parámetros de ruta, consultas y JSON. Se rechazan propiedades desconocidas. Todos los errores de la aplicación siguen esta forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos",
    "details": [{ "field": "customerName", "message": "Too small" }],
    "requestId": "identificador-para-diagnóstico"
  }
}
```

## Contrato y solicitudes reproducibles

- [`openapi.yaml`](openapi.yaml): contrato OpenAPI 3.2.0 con esquemas, ejemplos, respuestas exitosas y errores.
- `GET /openapi.yaml` y `GET /openapi.json`: contrato servido por la aplicación.
- [`requests/demo.http`](requests/demo.http): colección ejecutable con REST Client de VS Code/JetBrains.
- `npm run demo`: demostración completa y determinista sin depender de `curl`.
- [`tests/api.test.ts`](tests/api.test.ts): pruebas automatizadas de los criterios de aceptación.

## Estructura

```text
src/app.ts          rutas, validación y semántica HTTP
src/store.ts        almacenamiento e idempotencia en memoria
src/server.ts       arranque del servidor
openapi.yaml        contrato OpenAPI 3.2
requests/demo.http  colección de solicitudes
scripts/demo.ts     demostración reproducible
tests/api.test.ts   pruebas de aceptación
```
