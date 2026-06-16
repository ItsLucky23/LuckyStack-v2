import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

//? Constant-time string comparison for security tokens (CSRF tokens, the
//? test-reset token). Plain `===` short-circuits on the first differing byte,
//? leaking length + prefix-match information through response timing. Compare
//? the UTF-8 byte buffers with `crypto.timingSafeEqual`, which requires equal
//? lengths — so we length-check first (itself not secret-dependent) and only
//? run the constant-time compare on equal-length inputs.
export const timingSafeStringEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return cryptoTimingSafeEqual(aBuf, bBuf);
};
