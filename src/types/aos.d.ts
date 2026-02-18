/**
 * @file src/types/aos.d.ts
 * @summary Ambient type declarations for the AOS (Animate On Scroll) library.
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
