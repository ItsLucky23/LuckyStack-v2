//? Framework-side upload helper. Wraps the `onUploadStart` / `onUploadComplete`
//? hook dispatch around an installer-provided encode/save callback so consumer
//? upload routes don't have to plumb the hooks themselves.
//?
//? Why a callback (not a built-in encoder): @luckystack/core stays free of
//? heavy native deps (sharp, ffmpeg, etc.). Consumers wire whichever encoder
//? fits their use case and the framework just brackets the call with the
//? hook contract.

import { dispatchHook } from './hooks/registry';
import tryCatch from './tryCatch';

export interface ProcessUploadInput {
  /** User the upload is associated with. */
  userId: string;
  /** Content type from the source (e.g. parsed from a data URL prefix). */
  contentType: string;
  /** Raw upload bytes — used for `sizeBytes` and passed to the encoder. */
  buffer: Buffer;
  /** Identifier for the upload category. Defaults to `'avatar'`. */
  uploadKind?: string;
  /** Final file name written to disk (used in the `onUploadComplete` payload). */
  fileName: string;
  /**
   * Project-supplied encode + write step. Receives the raw buffer, does
   * whatever encoding/resizing the installer wants (sharp, ffmpeg, raw fs
   * write, S3 upload, etc.), and returns the final byte size on disk —
   * pass through `buffer.byteLength` if you don't have a meaningful
   * post-encode size.
   */
  encodeAndSave: (buffer: Buffer) => Promise<number>;
}

export type ProcessUploadResult =
  | { status: 'success'; sizeBytes: number }
  | { status: 'rejected'; errorCode: string }
  | { status: 'error'; reason: string; cause?: unknown };

/**
 * Run a project-side upload through the framework's hook contract.
 *
 * Order of operations:
 *   1. Dispatch `onUploadStart` — handlers may return a stop signal to reject
 *      the upload (content moderation, virus scanner, quota check).
 *   2. Run the project-supplied `encodeAndSave` callback (wrapped in tryCatch).
 *   3. Dispatch `onUploadComplete` with the final `sizeBytes`.
 *
 * Returns one of three statuses so the caller can map to its own response
 * envelope without inspecting hook internals.
 */
export const processUpload = async (input: ProcessUploadInput): Promise<ProcessUploadResult> => {
  const uploadKind = input.uploadKind ?? 'avatar';

  const startSignal = await dispatchHook('onUploadStart', {
    userId: input.userId,
    contentType: input.contentType,
    sizeBytes: input.buffer.byteLength,
    uploadKind,
  });
  if (startSignal.stopped) {
    return { status: 'rejected', errorCode: startSignal.signal.errorCode };
  }

  const [error, finalSize] = await tryCatch(() => input.encodeAndSave(input.buffer));
  if (error) {
    return { status: 'error', reason: error.message || 'encode-failed', cause: error };
  }

  const sizeBytes = finalSize ?? input.buffer.byteLength;
  await dispatchHook('onUploadComplete', {
    userId: input.userId,
    fileName: input.fileName,
    sizeBytes,
    uploadKind,
  });

  return { status: 'success', sizeBytes };
};
