import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Sizes we keep for every image: the feed size and a thumbnail (docs/api-contract.md section 6). */
export const FULL_WIDTH = 1080;
export const THUMB_WIDTH = 320;
/** Very tall images are shrunk to fit inside width x (4 x width). */
const MAX_ASPECT = 4;
/** Refuse images with more pixels than this before decoding them (decompression bombs). */
const MAX_INPUT_PIXELS = 50_000_000;

/** Formats we accept, by what the file really is — never by its name or the browser's claim. */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

// The server is shared and short on memory: one libvips thread, no operation cache.
sharp.concurrency(1);
sharp.cache(false);

export class ImageError extends Error {
  constructor(
    readonly code: 'not_an_image' | 'unsupported_format' | 'heic_not_supported' | 'too_many_pixels',
    message: string,
  ) {
    super(message);
  }
}

export type ProcessedImage = { width: number; height: number; bytes: number };

/**
 * Turns an uploaded file into <outDir>/1080.webp and <outDir>/320.webp.
 * Applies the camera's rotation, then drops all metadata (EXIF, GPS location, colour profiles
 * are not copied), never enlarges, and keeps only the first frame of an animation.
 * On any failure nothing is left in outDir.
 */
export async function processImage(inputFile: string, outDir: string): Promise<ProcessedImage> {
  let format: string | undefined;
  let pixels = 0;
  try {
    const meta = await sharp(inputFile, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    format = meta.format;
    pixels = (meta.width ?? 0) * (meta.height ?? 0);
  } catch {
    throw new ImageError('not_an_image', 'That file is not an image we can read.');
  }
  if (format === 'heif') {
    throw new ImageError('heic_not_supported', 'HEIC photos are not supported yet. Please choose a JPEG or PNG.');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw new ImageError('unsupported_format', 'Please choose a JPEG, PNG or WebP image.');
  }
  if (pixels === 0 || pixels > MAX_INPUT_PIXELS) {
    throw new ImageError('too_many_pixels', 'That image is too large. Please choose a smaller one.');
  }

  await mkdir(outDir, { recursive: true });
  try {
    const render = (width: number, quality: number, file: string) =>
      sharp(inputFile, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // apply the EXIF orientation before the metadata is dropped
        .resize({ width, height: width * MAX_ASPECT, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toFile(path.join(outDir, file));

    const full = await render(FULL_WIDTH, 80, `${FULL_WIDTH}.webp`);
    await render(THUMB_WIDTH, 72, `${THUMB_WIDTH}.webp`);
    const { size } = await stat(path.join(outDir, `${FULL_WIDTH}.webp`));
    return { width: full.width, height: full.height, bytes: size };
  } catch (err) {
    await rm(outDir, { recursive: true, force: true });
    if (err instanceof ImageError) throw err;
    throw new ImageError('not_an_image', 'That file is not an image we can read.');
  }
}
