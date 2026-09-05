export type BookStatus = 'AVAILABLE' | 'BORROWED';

// Storage shapes are deliberately richer than the public SDL.
export interface AuthorRecord {
  id: string;
  name: string;
  bio: string | null;
  internalNotes: string;
}

export interface BookRecord {
  id: string;
  title: string;
  summary: string | null;
  status: BookStatus;
  authorId: string;
  internalNotes: string;
}

export interface BookFilterInput {
  title?: string | null;
  authorId?: string | null;
  status?: BookStatus | null;
}

export interface PageInput {
  page?: number;
  pageSize?: number;
}

export interface ValidPage {
  page: number;
  pageSize: number;
}

export interface CreateBookInput {
  title: string;
  summary?: string | null;
  authorId: string;
}

export interface ValidCreateBook {
  title: string;
  summary: string | null;
  authorId: string;
}

export interface PageInfo extends ValidPage {
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface BookPage {
  items: BookRecord[];
  pageInfo: PageInfo;
}

export interface DataAccess {
  bookReads: number;
  authorBatchReads: number;
  authorKeysLoaded: number;
}
