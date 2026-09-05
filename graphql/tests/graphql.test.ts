import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { LibraryStore } from '../src/store.js';

interface Book {
  id?: string;
  title?: string;
  summary?: string | null;
  status?: string;
  author?: { id?: string; name?: string; bio?: string | null };
}

interface Result {
  data?: {
    book?: Book | null;
    books?: {
      items: Book[];
      pageInfo: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
      };
    };
    createBook?: Book | null;
    updateBookStatus?: Book | null;
    __type?: { fields: Array<{ name: string }> };
  } | null;
  errors?: Array<{ message: string; extensions?: { code?: string; [key: string]: unknown } }>;
  extensions?: {
    dataAccess: { bookReads: number; authorBatchReads: number; authorKeysLoaded: number };
  };
}

const listQuery = `query Listar($filter: BookFilterInput, $page: PageInput) {
  books(filter: $filter, page: $page) {
    items { id title status author { id name } }
    pageInfo { page pageSize totalItems totalPages hasNextPage }
  }
}`;
const createMutation = `mutation Crear($input: CreateBookInput!) {
  createBook(input: $input) { id title summary status author { id name } }
}`;
const detailQuery = `query Obtener($id: ID!) {
  book(id: $id) { id title summary status author { id name } }
}`;

describe('Contrato HTTP GraphQL de biblioteca', () => {
  let store: LibraryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new LibraryStore();
    app = createApp(store);
  });

  async function execute(query: string, operationName: string, variables: Record<string, unknown> = {}) {
    const response = await app.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, operationName, variables }),
    });
    return await response.json() as Result;
  }

  it('consulta por ID y responde solamente los campos seleccionados', async () => {
    const result = await execute(
      'query Elegir($id: ID!) { book(id: $id) { title author { name } } }',
      'Elegir', { id: 'b1' },
    );
    expect(result.errors).toBeUndefined();
    expect(Object.keys(result.data!.book!)).toEqual(['title', 'author']);
    expect(Object.keys(result.data!.book!.author!)).toEqual(['name']);
    expect(result.data!.book!.author!.name).toEqual(expect.any(String));
  });

  it('filtra antes de paginar y mantiene metadatos consistentes', async () => {
    const variables = { filter: { status: 'AVAILABLE' }, page: { page: 1, pageSize: 3 } };
    const first = await execute(listQuery, 'Listar', variables);
    expect(first.errors).toBeUndefined();
    expect(first.data!.books!.items).toHaveLength(3);
    expect(first.data!.books!.items.every(book => book.status === 'AVAILABLE')).toBe(true);
    expect(first.data!.books!.pageInfo).toEqual({
      page: 1, pageSize: 3, totalItems: 4, totalPages: 2, hasNextPage: true,
    });
    const second = await execute(listQuery, 'Listar', { ...variables, page: { page: 2, pageSize: 3 } });
    expect(second.data!.books!.items).toHaveLength(1);
    expect(second.data!.books!.pageInfo.hasNextPage).toBe(false);
    const allIds = [...first.data!.books!.items, ...second.data!.books!.items].map(book => book.id);
    expect(new Set(allIds).size).toBe(4);
  });

  it('combina filtros de título, autor y estado', async () => {
    const detail = await execute(detailQuery, 'Obtener', { id: 'b1' });
    const book = detail.data!.book!;
    const result = await execute(listQuery, 'Listar', {
      filter: { title: book.title!.toUpperCase(), authorId: book.author!.id, status: book.status },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data!.books!.items.map(item => item.id)).toContain('b1');
    expect(result.data!.books!.items.every(item => item.author!.id === book.author!.id)).toBe(true);
  });

  it('devuelve una colección vacía para filtros sin coincidencias y páginas posteriores al final', async () => {
    const empty = await execute(listQuery, 'Listar', { filter: { title: 'titulo_sin_coincidencias_90210' } });
    expect(empty.errors).toBeUndefined();
    expect(empty.data!.books!.items).toEqual([]);
    expect(empty.data!.books!.pageInfo).toMatchObject({ totalItems: 0, totalPages: 0, hasNextPage: false });
    const beyond = await execute(listQuery, 'Listar', { page: { page: 100, pageSize: 3 } });
    expect(beyond.errors).toBeUndefined();
    expect(beyond.data!.books!.items).toEqual([]);
    expect(beyond.data!.books!.pageInfo).toMatchObject({ page: 100, totalItems: 6, hasNextPage: false });
  });

  it('aplica la página predeterminada y permite el límite máximo', async () => {
    const defaults = await execute(listQuery, 'Listar');
    expect(defaults.errors).toBeUndefined();
    expect(defaults.data!.books!.pageInfo).toMatchObject({ page: 1, pageSize: 5 });
    expect(defaults.data!.books!.items).toHaveLength(5);
    const max = await execute(listQuery, 'Listar', { page: { pageSize: 20 } });
    expect(max.errors).toBeUndefined();
    expect(max.data!.books!.items).toHaveLength(6);
  });

  it.each([{ pageSize: 21 }, { pageSize: 0 }, { pageSize: -1 }, { page: 0 }])(
    'rechaza paginación inválida %j antes de acceder a datos', async page => {
      const read = vi.spyOn(store, 'listBooks');
      const result = await execute(listQuery, 'Listar', { page });
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('crea, normaliza y permite volver a consultar el libro', async () => {
    const created = await execute(createMutation, 'Crear', {
      input: { title: '  Nuevo libro  ', summary: '  Una sinopsis  ', authorId: 'a1' },
    });
    expect(created.errors).toBeUndefined();
    expect(created.data!.createBook).toMatchObject({
      title: 'Nuevo libro', summary: 'Una sinopsis', status: 'AVAILABLE', author: { id: 'a1' },
    });
    const saved = await execute(detailQuery, 'Obtener', { id: created.data!.createBook!.id });
    expect(saved.errors).toBeUndefined();
    expect(saved.data!.book).toEqual(created.data!.createBook);
  });

  it('representa una sinopsis omitida como null intencionalmente', async () => {
    const result = await execute(createMutation, 'Crear', { input: { title: 'Sin sinopsis', authorId: 'a1' } });
    expect(result.errors).toBeUndefined();
    expect(result.data!.createBook!.summary).toBeNull();
  });

  it('modifica el estado y hace visible el cambio en consultas posteriores', async () => {
    const changed = await execute(`mutation Prestar($id: ID!, $status: BookStatus!) {
      updateBookStatus(id: $id, status: $status) { id status }
    }`, 'Prestar', { id: 'b1', status: 'BORROWED' });
    expect(changed.errors).toBeUndefined();
    expect(changed.data!.updateBookStatus).toEqual({ id: 'b1', status: 'BORROWED' });
    const saved = await execute(detailQuery, 'Obtener', { id: 'b1' });
    expect(saved.data!.book!.status).toBe('BORROWED');
  });

  it('rechaza títulos en blanco sin escribir registros', async () => {
    const write = vi.spyOn(store, 'createBook');
    const result = await execute(createMutation, 'Crear', { input: { title: '   ', authorId: 'a1' } });
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(result.errors?.[0]?.message).toEqual(expect.any(String));
    expect(write).not.toHaveBeenCalled();
    const listing = await execute(listQuery, 'Listar');
    expect(listing.data!.books!.pageInfo.totalItems).toBe(6);
  });

  it.each([
    { title: 'x'.repeat(121), authorId: 'a1' },
    { title: 'Título válido', summary: 'x'.repeat(1001), authorId: 'a1' },
  ])('rechaza textos por encima del límite antes de escribir', async input => {
    const write = vi.spyOn(store, 'createBook');
    const result = await execute(createMutation, 'Crear', { input });
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(write).not.toHaveBeenCalled();
  });

  it('rechaza un filtro de título de más de 120 caracteres antes de leer', async () => {
    const read = vi.spyOn(store, 'listBooks');
    const result = await execute(listQuery, 'Listar', { filter: { title: 'x'.repeat(121) } });
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(read).not.toHaveBeenCalled();
  });

  it('rechaza un autor inexistente y no deja un libro huérfano', async () => {
    const result = await execute(createMutation, 'Crear', { input: { title: 'Libro huérfano', authorId: 'a999' } });
    expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    const listing = await execute(listQuery, 'Listar');
    expect(listing.data!.books!.pageInfo.totalItems).toBe(6);
  });

  it('distingue un ID mal formado de un recurso inexistente', async () => {
    const malformed = await execute(detailQuery, 'Obtener', { id: '  ' });
    expect(malformed.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    const absent = await execute(detailQuery, 'Obtener', { id: 'b999' });
    expect(absent.data!.book).toBeNull();
    expect(absent.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    const update = await execute(`mutation Cambiar($id: ID!, $status: BookStatus!) {
      updateBookStatus(id: $id, status: $status) { id }
    }`, 'Cambiar', { id: 'b999', status: 'BORROWED' });
    expect(update.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('el enum impide un estado fuera del contrato antes de modificar datos', async () => {
    const write = vi.spyOn(store, 'updateBookStatus');
    const result = await execute(`mutation Estado($id: ID!, $status: BookStatus!) {
      updateBookStatus(id: $id, status: $status) { id }
    }`, 'Estado', { id: 'b1', status: 'INVENTADO' });
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('la nulabilidad conserva un campo válido cuando otro libro no existe', async () => {
    const result = await execute(`query Parcial($known: ID!, $missing: ID!) {
      known: book(id: $known) { id }
      missing: book(id: $missing) { id }
    }`, 'Parcial', { known: 'b1', missing: 'b999' });
    expect(result.data).toEqual({ known: { id: 'b1' }, missing: null });
    expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('carga seis libros y sus tres autores con una lectura de libros y un lote', async () => {
    const batches = vi.spyOn(store, 'getAuthorsByIds');
    const result = await execute(listQuery, 'Listar', { page: { pageSize: 6 } });
    expect(result.errors).toBeUndefined();
    expect(result.data!.books!.items).toHaveLength(6);
    expect(batches).toHaveBeenCalledTimes(1);
    expect(new Set(batches.mock.calls[0]![0])).toEqual(new Set(['a1', 'a2', 'a3']));
    expect(result.extensions!.dataAccess).toEqual({ bookReads: 1, authorBatchReads: 1, authorKeysLoaded: 3 });
  });

  it('omite por completo el acceso a autores si el cliente no pide la relación', async () => {
    const batches = vi.spyOn(store, 'getAuthorsByIds');
    const result = await execute(`query Titulos($page: PageInput) {
      books(page: $page) { items { id title } }
    }`, 'Titulos', { page: { pageSize: 6 } });
    expect(result.errors).toBeUndefined();
    expect(batches).not.toHaveBeenCalled();
    expect(result.extensions!.dataAccess).toEqual({ bookReads: 1, authorBatchReads: 0, authorKeysLoaded: 0 });
  });

  it('crea el loader por petición y no comparte una caché entre clientes', async () => {
    const batches = vi.spyOn(store, 'getAuthorsByIds');
    const first = await execute(listQuery, 'Listar', { page: { pageSize: 6 } });
    const second = await execute(listQuery, 'Listar', { page: { pageSize: 6 } });
    expect(first.errors).toBeUndefined();
    expect(second.errors).toBeUndefined();
    expect(batches).toHaveBeenCalledTimes(2);
    expect(first.extensions!.dataAccess.authorBatchReads).toBe(1);
    expect(second.extensions!.dataAccess.authorBatchReads).toBe(1);
  });

  it('oculta detalles y trazas de errores inesperados', async () => {
    vi.spyOn(store, 'getBook').mockImplementation(() => { throw new Error('INTERNAL_TEST_SENTINEL'); });
    const result = await execute(detailQuery, 'Obtener', { id: 'b1' });
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('INTERNAL_TEST_SENTINEL');
    expect(serialized).not.toContain('stacktrace');
    expect(serialized).not.toContain('graphql.test.ts');
  });

  it('también enmascara una falla asíncrona del lote de autores', async () => {
    vi.spyOn(store, 'getAuthorsByIds').mockRejectedValue(new Error('ASYNC_INTERNAL_TEST_SENTINEL'));
    const result = await execute(detailQuery, 'Obtener', { id: 'b1' });
    expect(result.data!.book).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ASYNC_INTERNAL_TEST_SENTINEL');
    expect(serialized).not.toContain('stacktrace');
    expect(serialized).not.toContain('graphql.test.ts');
  });

  it('expone la relación del dominio y conserva privados los campos de almacenamiento', async () => {
    const result = await execute('query Contrato { __type(name: "Book") { fields { name } } }', 'Contrato');
    expect(result.errors).toBeUndefined();
    const names = result.data!.__type!.fields.map(field => field.name);
    expect(names.sort()).toEqual(['author', 'id', 'status', 'summary', 'title']);
    expect(names).not.toContain('authorId');
  });
});
