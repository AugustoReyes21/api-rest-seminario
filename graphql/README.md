# Biblioteca GraphQL en TypeScript

Servicio reproducible de catálogo y préstamos con **GraphQL Yoga**, TypeScript estricto y datos en memoria. Un cliente puede pedir únicamente los títulos de los libros; otro puede recorrer `Book.author` y obtener los nombres de sus autores en la misma operación. El esquema público representa esa necesidad del catálogo.

## Instalación y ejecución

Requisitos: Node.js 22 o superior y npm. Desde la raíz del repositorio:

```sh
cd graphql
npm ci
npm run dev
```

Abra [la aplicación de demostración](http://127.0.0.1:4000/) o [GraphiQL](http://127.0.0.1:4000/graphql). La aplicación permite elegir operaciones, editar sus variables, enviarlas al servicio y revisar la respuesta y los accesos a datos. GraphiQL permite escribir operaciones libremente y explorar el esquema.

Para compilar y ejecutar JavaScript:

```sh
npm run build
npm start
```

El servicio escucha en `127.0.0.1:4000`. `PORT` permite cambiar el puerto. No requiere variables secretas, autenticación, una base de datos ni servicios externos. Reiniciar el proceso recupera los seis libros y tres autores iniciales; los cambios realizados en memoria se pierden.

## Verificación reproducible

```sh
npm run check
npm run demo
```

`check` compila TypeScript y ejecuta las pruebas HTTP mediante `Yoga.fetch()`, sin ocupar un puerto. `demo` envía las ocho operaciones documentadas a una instancia nueva de Yoga y verifica sus resultados, incluidos los errores esperados.

También puede ejecutar las mismas operaciones contra el servidor iniciado en otra terminal:

```sh
npm run demo -- --http http://127.0.0.1:4000/graphql
```

Este último comando modifica los datos del servidor: crea un libro y cambia el estado de `b1`. Para repetir la demostración desde el mismo punto, reinicie el servicio. El script falla con salida distinta de cero si una operación no produce el resultado esperado.

## Esquema y decisiones

El contrato SDL completo está en [schema.graphql](schema.graphql), con descripciones de las operaciones e inputs. Los resolvers están en [src/app.ts](src/app.ts); el almacén y sus tipos privados se definen separadamente en `src/store.ts` y `src/types.ts`.

| Elemento público | Decisión |
| --- | --- |
| `Book` y `Author` | Un libro tiene un autor; cada autor puede corresponder a varios libros del catálogo. |
| `Book.author: Author!` | Todo libro debe referenciar un autor existente. La creación valida la relación antes de escribir. |
| `Book.summary` y `Author.bio` | Son `String` anulables: `null` significa información todavía no registrada. |
| `Query.book: Book` | Es anulable: un recurso inexistente devuelve `book: null` y un error `NOT_FOUND`, conservando otros campos raíz válidos. |
| Mutations que devuelven `Book` | Son anulables para comunicar un fallo de esa operación sin convertir todo el resultado en un error no nulo. |
| `BookPage.items: [Book!]!` | La lista y cada libro existen; una página sin resultados es `[]`. Sus metadatos tampoco son nulos. |
| `BookStatus` | Enum cerrado: `AVAILABLE` o `BORROWED`; los libros nuevos están disponibles. |
| `CreateBookInput` | Acepta título, resumen opcional e identificador del autor. El cliente no controla el ID generado ni notas internas. |

El esquema **no publica** `internalNotes` ni el enlace de almacenamiento `BookRecord.authorId`; ofrece el campo de dominio `author`. No se añadió una relación inversa recursiva ni operaciones administrativas que el caso no necesita. GraphQL elige campos públicos del esquema, no permite acceder arbitrariamente a los campos del almacenamiento.

## Operaciones con variables

Las definiciones están en [examples/operations.graphql](examples/operations.graphql). [examples/scenarios.json](examples/scenarios.json) contiene, para cada caso, el nombre de operación, el documento GraphQL y sus variables JSON. La aplicación y el script consumen ese mismo archivo.

| Nombre de operación | Finalidad |
| --- | --- |
| `ConsultarLibro` | Buscar `b1` por ID y seleccionar título, estado y nombre del autor. |
| `ListarLibros` | Filtrar libros disponibles, paginar y recorrer la relación de autor. |
| `CrearLibro` | Crear un libro con `CreateBookInput`. |
| `CambiarEstado` | Cambiar `b1` a `BORROWED` mediante el enum. |
| `CrearLibroInvalido` | Rechazar un título compuesto por espacios. |
| `ComprobarLimite` | Rechazar una página de 21 elementos. |
| `ConsultarInexistente` | Demostrar `NOT_FOUND` para `b999`. |
| `ListarSoloTitulos` | Comprobar que omitir `author` evita acceder a autores. |

Ejemplo del cuerpo JSON enviado a `POST /graphql`:

```json
{
  "operationName": "ConsultarLibro",
  "query": "query ConsultarLibro($id: ID!) { book(id: $id) { title status author { name } } }",
  "variables": { "id": "b1" }
}
```

El servidor responde con los campos seleccionados. No devuelve `summary`, `author.id` ni `author.bio` porque esa operación no los solicitó.

## Validación, errores y paginación

Las validaciones del dominio están en [src/validation.ts](src/validation.ts). GraphQL valida antes de los resolvers los tipos, los campos requeridos y los valores del enum. Las comprobaciones adicionales son:

- ID: de 1 a 64 letras, números, guiones o guiones bajos.
- Título: de 1 a 120 caracteres después de quitar espacios exteriores.
- Resumen: hasta 1000 caracteres; omitido, vacío o en blanco se normaliza a `null`.
- Autor de un libro nuevo: debe existir; no se crean libros con referencias huérfanas.
- Filtro de título: hasta 120 caracteres; búsqueda por fragmento sin distinguir mayúsculas.
- Página: entero desde 1; tamaño entre 1 y **20**, con valores predeterminados 1 y 5.

Los filtros de título, autor y estado se combinan con AND y se aplican **antes** de calcular `totalItems`, `totalPages` y el recorte de página. El orden es el de incorporación al catálogo. Una página posterior al final devuelve una lista vacía y conserva el total de coincidencias. Sin coincidencias, `totalPages` es 0 y `hasNextPage` es `false`.

Una entrada inválida produce `errors[].extensions.code: "BAD_USER_INPUT"` e indica el campo. Un libro o autor solicitado que no existe produce `NOT_FOUND`. Un fallo inesperado se enmascara como `INTERNAL_SERVER_ERROR` con el mensaje público «No fue posible completar la operación.». No se devuelven la excepción original ni trazas, incluso en desarrollo (`maskedErrors.isDev: false`). Los detalles internos pueden registrarse en la terminal del servidor.

Los errores de ejecución GraphQL pueden llegar con HTTP 200; el cliente debe revisar `errors`, además del estado HTTP. Si falla `books`, su nulabilidad `BookPage!` provoca `data: null`; si falla `book`, el resultado conserva `book: null` y los demás campos raíz que se pudieron resolver.

El máximo de **20 libros por campo de colección** es el límite operativo de este ejercicio. También se deshabilita el envío de varias operaciones en un arreglo HTTP (`batching: false`). Estos controles no equivalen a una protección completa de producción: los alias pueden repetir campos de colección dentro de una operación. Un servicio expuesto necesitaría presupuestos globales de complejidad, limitación de frecuencia y límites de cuerpo/tiempo acordes con su carga. La paginación por número es sencilla aquí, pero un catálogo con mucha escritura concurrente puede requerir cursores para evitar desplazamientos entre páginas.

## Relación y evidencia contra N+1

[src/context.ts](src/context.ts) crea un **DataLoader nuevo por petición**, junto con contadores nuevos. Cada resolver `Book.author` llama `authorLoader.load(book.authorId)`. DataLoader deduplica los identificadores repetidos y agrupa las cargas pendientes en una llamada a `store.getAuthorsByIds(ids)`. El repositorio devuelve una posición por ID, en el mismo orden, incluido `undefined` cuando falta un autor.

Se observa el trabajo realizado en `extensions.dataAccess` de cada respuesta:

```json
{
  "bookReads": 1,
  "authorBatchReads": 1,
  "authorKeysLoaded": 2
}
```

Ese resultado corresponde a `ListarLibros` con los datos iniciales: la primera página contiene tres libros disponibles (`b1`, `b3`, `b4`), pero solamente dos autores distintos (`a1`, `a2`). Una lectura obtiene la colección y **un lote** resuelve los autores. Consultar los seis libros también requiere un lote, con tres claves distintas. Seleccionar únicamente títulos produce `authorBatchReads: 0` y `authorKeysLoaded: 0`.

Son contadores de accesos **lógicos al repositorio en memoria**, no mediciones de consultas SQL ni de latencia de red. El lote usa búsquedas en un `Map`; una implementación con base de datos tendría que reemplazarlo por una consulta equivalente a `WHERE id IN (...)`, conservando el orden de resultados. La caché dura una petición; no se reutilizan datos ni contadores entre clientes. En la creación también se usa ese loader para validar al autor y reutilizarlo si la respuesta pide `author`.

[tests/graphql.test.ts](tests/graphql.test.ts) comprueba realmente las llamadas mediante spies: seis libros, un lote y tres claves; cero accesos si se omite la relación; un lote nuevo en cada petición. Las pruebas también cubren selección de campos, filtrado previo a paginación, límites, valores predeterminados, página vacía, escritura y lectura posterior, enum inválido, recursos inexistentes, rechazo sin efectos y enmascaramiento de una excepción interna inyectada.

## El mismo caso con REST

Un diseño REST posible usaría `GET /books/b1`, `GET /books?status=AVAILABLE&page=1&pageSize=3`, `GET /authors/a1`, `POST /books` y `PATCH /books/b1` con un cuerpo como `{"status":"BORROWED"}`. Un cliente que recibe solamente `authorId` tendría que consultar autores aparte; el servidor REST también podría incluir autores o aceptar `include=author` para resolverlo en una sola petición y precargarlos por lotes.

En este catálogo, GraphQL permite que un cliente obtenga solo títulos y otro títulos con nombres de autores usando el mismo contrato tipado. Evita definir una respuesta distinta por pantalla y facilita recorrer relaciones. A cambio, el servidor debe controlar el costo de los campos seleccionables, las cargas de relaciones y los errores parciales; la caché HTTP convencional resulta menos directa con operaciones POST.

REST ofrece rutas y códigos HTTP familiares, respuestas más predecibles y buen aprovechamiento de cachés HTTP. Puede necesitar parámetros de expansión/proyección o varias peticiones cuando las pantallas requieren combinaciones diferentes. Ambos estilos necesitan validación y una estrategia de acceso a datos: usar GraphQL por sí solo no elimina N+1, y usar REST no obliga a sufrirlo. La elección depende de la variedad de clientes, la simplicidad operativa y los requisitos de caché.

## Referencias técnicas

- [GraphQL Yoga: enmascaramiento de errores](https://the-guild.dev/graphql/yoga-server/docs/features/error-masking).
- [DataLoader: carga por lotes, orden de resultados y caché por petición](https://github.com/graphql/dataloader).
