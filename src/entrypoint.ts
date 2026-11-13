import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface EntrypointOptions {
  platform?: NodeJS.Platform;
  realpath?: (path: string) => string;
}

function canonical(path: string, realpath: (path: string) => string, platform: NodeJS.Platform): string {
  let real: string;
  try {
    real = realpath(path);
  } catch {
    // A path that does not exist (or cannot be read) is compared as given.
    real = path;
  }
  // Windows paths are case-insensitive, including the drive letter (c:\ vs C:\).
  return platform === "win32" ? real.toLowerCase() : real;
}

/**
 * True when this module is the program node was asked to run.
 *
 * npx, `npm install -g` and node_modules/.bin start the package through a
 * symlink (or a shim), so process.argv[1] is the link while import.meta.url is
 * the real file. Both sides are compared as real file-system paths: the module
 * URL is decoded with fileURLToPath (percent-encoded spaces, `#` or non-ASCII
 * characters), argv[1] is resolved against the working directory, and each side
 * is passed through realpath, falling back to the plain path when it fails.
 */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined = process.argv[1], options: EntrypointOptions = {}): boolean {
  if (!argv1) return false;
  const platform = options.platform ?? process.platform;
  const realpath = options.realpath ?? realpathSync.native;
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  return canonical(resolve(argv1), realpath, platform) === canonical(modulePath, realpath, platform);
}
