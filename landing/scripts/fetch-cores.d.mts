// Type declarations for the pure helpers exported by the core-fetch build
// script, so TypeScript tests can import them without `allowJs`.

/** Decide how to extract a downloaded core archive on a given platform. */
export function extractCommand(
  archive: string,
  dest: string,
  platform: string,
): { cmd: string; args: string[] };

/** Resolve the target OS ('darwin' | 'linux' | 'win32') from a Rust target
 *  triple, falling back to the host platform (cross-compile safety). */
export function resolvePlatform(triple: string, hostPlatform: string): string;

/** Resolve the target CPU arch ('x64' | 'arm64') from a Rust target triple,
 *  falling back to the host arch (cross-compile safety). */
export function resolveArch(triple: string, hostArch: string): string;
