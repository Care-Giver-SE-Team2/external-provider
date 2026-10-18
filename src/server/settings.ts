// The server's settings: the environment first, then `.env`. `.env` is read again whenever it changes, so a
// partner's credentials added there work without a restart.

import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseEnv } from 'node:util';

export interface Settings {
  /** A setting's value, or undefined when it is missing or empty. */
  get(key: string): string | undefined;
  close(): void;
}

export interface SettingsOptions {
  /** The `.env` file, or null to read the environment only. */
  envFile: string | null;
  /** Read `.env` again when it changes. Off for one-off commands, which would otherwise never exit. */
  watchFile?: boolean;
  env?: NodeJS.ProcessEnv;
  onReload?: () => void;
}

export function createSettings({ envFile, watchFile = false, env = process.env, onReload }: SettingsOptions): Settings {
  let fromFile: Record<string, string> = {};

  const read = () => {
    if (!envFile) return;
    try {
      fromFile = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') fromFile = {};
      else console.warn(`${envFile} could not be read: ${(e as Error).message}`);
    }
  };
  read();

  // Editors often save by replacing the file, so the folder is watched rather than the file.
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (envFile && watchFile) {
    const name = basename(envFile);
    watcher = watch(dirname(envFile), (_event, changed) => {
      if (changed !== name) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        read();
        onReload?.();
      }, 100);
    });
  }

  return {
    // As usual, a variable set in the environment wins over `.env`.
    get: (key) => (env[key] || fromFile[key] || undefined),
    close: () => {
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
