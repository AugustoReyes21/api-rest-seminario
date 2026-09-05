import type { AuthorRecord, BookFilterInput, BookPage, BookRecord, BookStatus, ValidCreateBook, ValidPage } from './types.js';

const seedAuthors: AuthorRecord[] = [
  { id: 'a1', name: 'Miguel Ángel Asturias', bio: 'Escritor guatemalteco.', internalNotes: 'Ficha revisada por administración.' },
  { id: 'a2', name: 'Isabel Allende', bio: 'Escritora chilena.', internalNotes: 'Ficha revisada por administración.' },
  { id: 'a3', name: 'Gabriel García Márquez', bio: null, internalNotes: 'Biografía pendiente de revisión.' },
];

const seedBooks: BookRecord[] = [
  { id: 'b1', title: 'El señor presidente', summary: 'Una novela sobre el poder y sus consecuencias.', status: 'AVAILABLE', authorId: 'a1', internalNotes: 'Estante A-1.' },
  { id: 'b2', title: 'Hombres de maíz', summary: null, status: 'BORROWED', authorId: 'a1', internalNotes: 'Estante A-2.' },
  { id: 'b3', title: 'La casa de los espíritus', summary: 'La historia de varias generaciones de una familia.', status: 'AVAILABLE', authorId: 'a2', internalNotes: 'Estante B-1.' },
  { id: 'b4', title: 'Eva Luna', summary: null, status: 'AVAILABLE', authorId: 'a2', internalNotes: 'Estante B-2.' },
  { id: 'b5', title: 'Cien años de soledad', summary: 'La familia Buendía y el pueblo de Macondo.', status: 'AVAILABLE', authorId: 'a3', internalNotes: 'Estante C-1.' },
  { id: 'b6', title: 'El coronel no tiene quien le escriba', summary: null, status: 'BORROWED', authorId: 'a3', internalNotes: 'Estante C-2.' },
];

/** A repository boundary: one method invocation represents one logical data access. */
export class LibraryStore {
  private readonly authors = new Map(seedAuthors.map(author => [author.id, { ...author }]));
  private readonly books = new Map(seedBooks.map(book => [book.id, { ...book }]));
  private nextBookId = seedBooks.length + 1;

  getBook(id: string): BookRecord | undefined {
    const book = this.books.get(id);
    return book && { ...book };
  }

  listBooks(filter: BookFilterInput, page: ValidPage): BookPage {
    const title = filter.title?.toLocaleLowerCase('es');
    const matches = [...this.books.values()].filter(book =>
      (!title || book.title.toLocaleLowerCase('es').includes(title)) &&
      (!filter.authorId || book.authorId === filter.authorId) &&
      (!filter.status || book.status === filter.status),
    );
    const totalItems = matches.length;
    const totalPages = Math.ceil(totalItems / page.pageSize);
    const start = (page.page - 1) * page.pageSize;
    return {
      items: matches.slice(start, start + page.pageSize).map(book => ({ ...book })),
      pageInfo: { ...page, totalItems, totalPages, hasNextPage: page.page < totalPages },
    };
  }

  /** One batch entry point; preserves order and missing values for DataLoader. */
  async getAuthorsByIds(ids: readonly string[]): Promise<(AuthorRecord | undefined)[]> {
    return ids.map(id => {
      const author = this.authors.get(id);
      return author && { ...author };
    });
  }

  createBook(input: ValidCreateBook): BookRecord {
    const book: BookRecord = {
      id: `b${this.nextBookId++}`,
      ...input,
      status: 'AVAILABLE',
      internalNotes: 'Creado desde el catálogo público.',
    };
    this.books.set(book.id, book);
    return { ...book };
  }

  updateBookStatus(id: string, status: BookStatus): BookRecord | undefined {
    const book = this.books.get(id);
    if (!book) return undefined;
    const updated = { ...book, status };
    this.books.set(id, updated);
    return { ...updated };
  }
}
