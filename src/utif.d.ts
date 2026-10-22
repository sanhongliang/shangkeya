declare module 'utif' {
  export interface TiffIFD {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  export function decode(buffer: ArrayBuffer | Uint8Array): TiffIFD[];
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: TiffIFD): void;
  export function toRGBA8(ifd: TiffIFD): Uint8Array;
}
