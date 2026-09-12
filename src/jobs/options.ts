import { DEFAULT_MODEL, DEFAULT_REMOVE_BACKGROUND, SUPPORTED_MODELS } from '../config';
import { InputError } from '../errors';
import { AUTO, isSupportedAspectRatio, isSupportedImageSize } from '../image-options';

export const MAX_PROMPT = 10000;
export const MAX_COUNT = 20;

/**
 * Validate the generation options shared by the HTTP API and the CLI.
 * `auto` is dropped on purpose: it means "do not send this field to the provider".
 */
export function validateOptions(input: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const model = input.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !SUPPORTED_MODELS.includes(model)) {
    throw new InputError('invalid model');
  }
  const aspectRatio = input.aspectRatio;
  if (
    aspectRatio !== undefined &&
    (typeof aspectRatio !== 'string' || (aspectRatio !== AUTO && !isSupportedAspectRatio(model, aspectRatio)))
  ) {
    throw new InputError('invalid aspectRatio for model');
  }
  const imageSize = input.imageSize;
  if (
    imageSize !== undefined &&
    (typeof imageSize !== 'string' || (imageSize !== AUTO && !isSupportedImageSize(model, imageSize)))
  ) {
    throw new InputError('invalid imageSize for model');
  }
  if (input.removeBackground !== undefined && typeof input.removeBackground !== 'boolean') {
    throw new InputError('invalid removeBackground');
  }
  options.model = model;
  if (aspectRatio !== undefined && aspectRatio !== AUTO) {
    options.aspectRatio = aspectRatio;
  }
  if (imageSize !== undefined && imageSize !== AUTO) {
    options.imageSize = imageSize;
  }
  options.removeBackground = input.removeBackground ?? DEFAULT_REMOVE_BACKGROUND;
  return options;
}
