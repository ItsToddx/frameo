import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Keep a prior profile and its encrypted account references intact on rename. */
export function profileLocation(currentPath: string, override?: string): string {
  if (override) return override;
  if (existsSync(join(currentPath, 'app.sqlite'))) return currentPath;
  const legacy = join(dirname(currentPath), 'Reelbeam');
  return existsSync(join(legacy, 'app.sqlite')) ? legacy : currentPath;
}
