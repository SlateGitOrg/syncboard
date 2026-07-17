// Vitest runs in jsdom, which does not implement IndexedDB. fake-indexeddb provides
// a full in-memory implementation so the real y-indexeddb persistence layer can be
// exercised in unit tests with zero network access and zero browser dependency.
import 'fake-indexeddb/auto';
