// A live heraldry texture from the shared rasterizer. The raster buffers and the
// texture are allocated once; a design change re-rasterizes in place, so the
// founding ceremony's per-element cycling never churns GPU or heap memory.

import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from '@iwsdk/core';
import { cloneHeraldry, heraldryEquals } from '../../../shared/legacy/content/heraldry';
import { HeraldryRasterizer } from '../../../shared/legacy/heraldry/raster';
import type { HeraldryAspect } from '../../../shared/legacy/heraldry/shapes';
import type { Heraldry } from '../../../shared/legacy/types';

export class HeraldryTexture {
  readonly texture: DataTexture;
  private readonly rasterizer = new HeraldryRasterizer();
  private readonly scratch: Uint8ClampedArray;
  private readonly pixels: Uint8ClampedArray;
  private current: Heraldry | null = null;

  constructor(readonly width: number, readonly height: number, readonly aspect: HeraldryAspect = 'banner') {
    this.scratch = new Uint8ClampedArray(width * height * 4);
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.texture = new DataTexture(this.pixels, width, height, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.name = 'Legacy heraldry';
  }

  /** Re-rasterizes only when the design changed. Returns true when the texture was updated. */
  show(heraldry: Heraldry): boolean {
    if (this.current && heraldryEquals(this.current, heraldry)) return false;
    this.current = cloneHeraldry(heraldry);
    this.rasterizer.rasterize(heraldry, { width: this.width, height: this.height, aspect: this.aspect }, this.scratch);
    // The raster is row-major from the top; texture rows start at the bottom.
    const stride = this.width * 4;
    for (let row = 0; row < this.height; row++) {
      this.pixels.set(this.scratch.subarray(row * stride, row * stride + stride), (this.height - 1 - row) * stride);
    }
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
    this.rasterizer.release();
    this.current = null;
  }
}
