import * as fs from 'fs';
import * as path from 'path';

function isFileMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Create the file with an empty JSON array when it does not exist yet,
 * including its parent directory on a fresh checkout.
 */
export function ensureJsonFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
