import { GraphQLError } from 'graphql';
import type { BookFilterInput, BookStatus, CreateBookInput, PageInput, ValidCreateBook, ValidPage } from './types.js';

export const MAX_PAGE_SIZE = 20;

/** Only this explicitly public error class may expose domain messages. */
export class PublicDomainError extends GraphQLError {}

export function badInput(message: string, field: string): never {
  throw new PublicDomainError(message, { extensions: { code: 'BAD_USER_INPUT', field } });
}

export function notFound(resource: 'Libro' | 'Autor'): never {
  throw new PublicDomainError(`${resource} no encontrado.`, { extensions: { code: 'NOT_FOUND' } });
}

export function validateId(value: string, field = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    badInput('El identificador debe contener entre 1 y 64 letras, números, guiones o guiones bajos.', field);
  }
  return value;
}

export function validateStatus(value: BookStatus): BookStatus {
  if (value !== 'AVAILABLE' && value !== 'BORROWED') {
    badInput('El estado debe ser AVAILABLE o BORROWED.', 'status');
  }
  return value;
}

export function validatePage(input?: PageInput | null): ValidPage {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 5;
  if (!Number.isInteger(page) || page < 1) {
    badInput('La página debe ser un entero mayor o igual a 1.', 'page.page');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    badInput(`El tamaño de página debe estar entre 1 y ${MAX_PAGE_SIZE}.`, 'page.pageSize');
  }
  return { page, pageSize };
}

export function validateFilter(input?: BookFilterInput | null): BookFilterInput {
  const filter: BookFilterInput = {};
  if (input?.title != null) {
    const title = input.title.trim();
    if (title.length > 120) badInput('El filtro de título admite hasta 120 caracteres.', 'filter.title');
    filter.title = title;
  }
  if (input?.authorId != null) filter.authorId = validateId(input.authorId, 'filter.authorId');
  if (input?.status != null) filter.status = validateStatus(input.status);
  return filter;
}

export function validateCreateBook(input: CreateBookInput): ValidCreateBook {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 120) {
    badInput('El título debe tener entre 1 y 120 caracteres después de quitar espacios.', 'input.title');
  }
  const summary = input.summary?.trim() || null;
  if (summary != null && summary.length > 1000) {
    badInput('El resumen admite hasta 1000 caracteres.', 'input.summary');
  }
  return { title, summary, authorId: validateId(input.authorId, 'input.authorId') };
}
