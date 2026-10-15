import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { woffToSfnt } from '../src/fonts/woff';

describe('WOFF → sfnt for PDF embedding', () => {
  for (const f of ['@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff', '@fontsource/libertinus-serif/files/libertinus-serif-cyrillic-400-normal.woff']) {
    test(f, async () => {
      const buf = readFileSync('node_modules/' + f);
      const sfnt = woffToSfnt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const font = fontkit.create(sfnt as never);
      expect(font.numGlyphs).toBeGreaterThan(10);
      const d = await PDFDocument.create();
      d.registerFontkit(fontkit);
      const pf = await d.embedFont(sfnt, { subset: !f.includes("stix") });
      const p = d.addPage([200, 60]);
      p.drawText(f.includes('stix') ? '∅′→⟨x⟩' : 'кошка', { x: 10, y: 20, size: 24, font: pf });
      const bytes = await d.save();
      expect(bytes.length).toBeGreaterThan(1000);
      if (process.env.WOFF_OUT) (await import('node:fs')).writeFileSync(`${process.env.WOFF_OUT}/${f.includes('stix') ? 'stix' : 'lib'}.pdf`, bytes);
    });
  }
});
