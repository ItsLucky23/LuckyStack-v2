import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

//? REGRESSION (sweep 114): canvas-confetti was loaded from a CDN into the
//? authenticated origin with no integrity pin, so a tampered CDN file would run
//? with full same-origin access (cookie-authenticated requests, /auth/csrf).

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, '..', 'index.html'), 'utf8')
  //? Commented-out tags are not loaded.
  .replaceAll(/<!--[\s\S]*?-->/g, '');

const externalScriptTags = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="(https?:)?\/\/[^"]*"[^>]*>/g)].map((match) => match[0]);

describe('index.html third-party scripts', () => {
  it('loads at least one external script (the check below is not vacuous)', () => {
    expect(externalScriptTags.length).toBeGreaterThan(0);
  });

  it.each(externalScriptTags)('pins %s with SRI and an anonymous CORS fetch', (tag) => {
    expect(tag).toMatch(/\bintegrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/);
    expect(tag).toMatch(/\bcrossorigin="anonymous"/);
    //? jsDelivr generates `.min.js` files that are not in the npm package on the
    //? fly; their bytes change with jsDelivr's minifier and break the hash.
    expect(tag).not.toMatch(/cdn\.jsdelivr\.net\/npm\/[^"]*\.min\.js"/);
  });
});
