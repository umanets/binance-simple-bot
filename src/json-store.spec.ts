import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonArray, writeJsonArray, ensureJsonFile } from './json-store';

describe('json-store', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats a missing file as an empty array', async () => {
    const missing = path.join(dir, 'missing.json');
    await expect(readJsonArray(missing)).resolves.toEqual([]);
  });

  it('throws on corrupt JSON instead of silently dropping data', async () => {
    const corrupt = path.join(dir, 'corrupt.json');
    fs.writeFileSync(corrupt, '[{"broken":');
    await expect(readJsonArray(corrupt)).rejects.toThrow();
  });

  it('round-trips an array', async () => {
    const file = path.join(dir, 'data.json');
    const items = [{ a: 1 }, { a: 2 }];
    await writeJsonArray(file, items);
    await expect(readJsonArray(file)).resolves.toEqual(items);
  });

  it('ensureJsonFile creates an empty array file only when missing', () => {
    const file = path.join(dir, 'ensure.json');
    ensureJsonFile(file);
    expect(fs.readFileSync(file, 'utf-8')).toBe('[]');
    fs.writeFileSync(file, '[1]');
    ensureJsonFile(file);
    expect(fs.readFileSync(file, 'utf-8')).toBe('[1]');
  });

  it('ensureJsonFile creates missing parent directories', () => {
    const nested = path.join(dir, 'deep', 'nested', 'data.json');
    ensureJsonFile(nested);
    expect(fs.readFileSync(nested, 'utf-8')).toBe('[]');
  });
});
