/**
 * @file src/platform/types/aos.d.ts
 * @summary Module for aos.d.
 *
 * @exports
 *  - (no named exports in this module)
 */

declare module "aos" {
  export type AOSConfig = Record<string, unknown>;

  export interface AOSModule {
    init(config?: AOSConfig): void;
    refresh(): void;
    refreshHard(): void;
  }

  const aos: AOSModule;
  export default aos;
}
