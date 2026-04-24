declare module "soundtouchjs" {
  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize?: number,
      onEnd?: () => void,
    );

    pitch: number;
    rate: number;
    tempo: number;
    duration: number;
    sampleRate: number;

    connect(toNode: AudioNode): void;
    disconnect(): void;
    on(eventName: string, cb: (detail: unknown) => void): void;
    off(eventName?: string | null): void;
  }
}