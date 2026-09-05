import { readFileSync } from 'node:fs';
import { GraphQLError } from 'graphql';
import { createSchema, createYoga, maskError, type Plugin } from 'graphql-yoga';
import { createContext, type LibraryContext } from './context.js';
import { projectPath } from './paths.js';
import { LibraryStore } from './store.js';
import type { BookFilterInput, BookRecord, BookStatus, CreateBookInput, PageInput } from './types.js';
import { PublicDomainError, notFound, validateCreateBook, validateFilter, validateId, validatePage, validateStatus } from './validation.js';

export const typeDefs = readFileSync(projectPath('schema.graphql'), 'utf8');

const resolvers = {
  Query: {
    book(_parent: unknown, { id }: { id: string }, context: LibraryContext) {
      const validId = validateId(id);
      context.dataAccess.bookReads += 1;
      return context.store.getBook(validId) ?? notFound('Libro');
    },
    books(_parent: unknown, args: { filter?: BookFilterInput | null; page?: PageInput | null }, context: LibraryContext) {
      const filter = validateFilter(args.filter);
      const page = validatePage(args.page);
      context.dataAccess.bookReads += 1;
      return context.store.listBooks(filter, page);
    },
  },
  Mutation: {
    async createBook(_parent: unknown, { input }: { input: CreateBookInput }, context: LibraryContext) {
      const validInput = validateCreateBook(input);
      const author = await context.authorLoader.load(validInput.authorId);
      if (!author) notFound('Autor');
      return context.store.createBook(validInput);
    },
    updateBookStatus(_parent: unknown, { id, status }: { id: string; status: BookStatus }, context: LibraryContext) {
      const validId = validateId(id);
      const validStatus = validateStatus(status);
      // updateBookStatus includes a lookup before the write.
      context.dataAccess.bookReads += 1;
      return context.store.updateBookStatus(validId, validStatus) ?? notFound('Libro');
    },
  },
  Book: {
    async author(book: BookRecord, _args: Record<string, never>, context: LibraryContext) {
      const author = await context.authorLoader.load(book.authorId);
      // Broken storage invariants are internal errors, unlike user-supplied IDs.
      if (!author) throw new Error('Author relation invariant failed.');
      return author;
    },
  },
};

function dataAccessPlugin(): Plugin<LibraryContext> {
  return {
    onExecute({ args }) {
      return {
        onExecuteDone({ result, setResult }) {
          // The schema has no subscriptions or incremental delivery.
          if (!('data' in result) && !('errors' in result)) return;
          setResult({
            ...result,
            extensions: { ...result.extensions, dataAccess: { ...args.contextValue.dataAccess } },
          });
        },
      };
    },
  };
}

/** Injectable Yoga instance: tests use app.fetch() without listening on a port. */
export function createApp(store: LibraryStore = new LibraryStore()) {
  return createYoga<{}, LibraryContext>({
    schema: createSchema<LibraryContext>({ typeDefs, resolvers }),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    batching: false,
    context: () => createContext(store),
    plugins: [dataAccessPlugin()],
    maskedErrors: {
      isDev: false,
      maskError(error, message) {
        // GraphQL may wrap resolver errors. ESM/CJS runtimes can load different
        // GraphQLError constructors, so recognize our own domain class instead.
        let cause: unknown = error;
        for (let depth = 0; depth < 8; depth += 1) {
          if (cause instanceof PublicDomainError) {
            const located = error as GraphQLError;
            return new GraphQLError(cause.message, {
              nodes: located.nodes,
              path: located.path,
              extensions: { ...cause.extensions },
            });
          }
          if (!cause || typeof cause !== 'object' || !('originalError' in cause)) break;
          cause = cause.originalError;
        }
        const masked = maskError(error, message, false);
        if (masked === error) return masked;
        return new GraphQLError('No fue posible completar la operación.', {
          nodes: masked instanceof GraphQLError ? masked.nodes : undefined,
          path: masked instanceof GraphQLError ? masked.path : undefined,
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      },
    },
  });
}
