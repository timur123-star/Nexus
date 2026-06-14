// Type declarations for the pure helpers exported by the core-fetch build
// script, so TypeScript tests can import them without `allowJs`.

/** Decide how to extract a downloaded core archive on a given platform. */
export function extractCommand(
  archive: string,
  dest: string,
  platform: string,
): { cmd: string; args: string[] };
