import DataLoader from 'dataloader';
import type { LibraryStore } from './store.js';
import type { AuthorRecord, DataAccess } from './types.js';

export interface LibraryContext {
  store: LibraryStore;
  dataAccess: DataAccess;
  authorLoader: DataLoader<string, AuthorRecord | undefined>;
}

/** Fresh instances prevent caches and counters from leaking across requests. */
export function createContext(store: LibraryStore): LibraryContext {
  const dataAccess: DataAccess = { bookReads: 0, authorBatchReads: 0, authorKeysLoaded: 0 };
  const authorLoader = new DataLoader<string, AuthorRecord | undefined>(async ids => {
    dataAccess.authorBatchReads += 1;
    dataAccess.authorKeysLoaded += ids.length;
    return store.getAuthorsByIds(ids);
  });
  return { store, dataAccess, authorLoader };
}
