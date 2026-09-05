import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source: src/paths.ts. Built output: dist/src/paths.js. Neither depends on cwd.
const sourceRoot = new URL('../', import.meta.url);
export const projectRoot = existsSync(new URL('schema.graphql', sourceRoot))
  ? sourceRoot
  : new URL('../../', import.meta.url);

export function projectPath(relative: string): string {
  return fileURLToPath(new URL(relative, projectRoot));
}
