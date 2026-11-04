import * as fs from 'fs';

function isFileMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Create the file with an empty JSON array when it does not exist yet. */
export function ensureJsonFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]');
  }
}

/**
 * Read a JSON array file. A missing file is a normal first-run condition and
 * yields []; corrupt JSON throws so callers never silently drop stored data.
 */
export async function readJsonArray<T>(filePath: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    if (isFileMissing(err)) return [];
    throw err;
  }
  return JSON.parse(text) as T[];
}

export async function writeJsonArray<T>(
  filePath: string,
  items: T[],
): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(items, null, 2));
}

/** Synchronous variant of readJsonArray with the same failure contract. */
export function readJsonArraySync<T>(filePath: string): T[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (isFileMissing(err)) return [];
    throw err;
  }
  return JSON.parse(text) as T[];
}

export function writeJsonArraySync<T>(filePath: string, items: T[]): void {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
}
