// Genera internal/protocol/nfc_tabla.go: los caracteres con los que una contraseña podría cambiar al pasar por
// NFC (la web hace `contraseña.normalize('NFC')`). La biblioteca estándar de Go no trae NFC, así que el CLI no
// normaliza: rechaza las contraseñas que contengan alguno de estos caracteres (ver nfc.go).
//
//   node cli/internal/protocol/gen/nfc.mjs > cli/internal/protocol/nfc_tabla.go   (con Node 24: ./dk.sh node …)
//
// Un carácter es «inestable» si:
//   1. NFC(c) ≠ c (singletons, exclusiones, CJK de compatibilidad…), o
//   2. es una marca (\p{M}): se reordenan y se componen con lo anterior, o
//   3. aparece en una posición no inicial de la NFD de algún carácter (puede componerse con el anterior:
//      jamos hangul V y T, vocales dependientes…), o
//   4. su NFD empieza por un carácter del punto 3.
// Si ningún carácter de una cadena es inestable, NFC(cadena) = cadena (ver nfc.go).

const MAX = 0x10ffff;
const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;
const nonInitial = new Set();
const nfdFirst = new Map();

for (let cp = 0; cp <= MAX; cp++) {
  if (isSurrogate(cp)) continue;
  const nfd = [...String.fromCodePoint(cp).normalize('NFD')].map((c) => c.codePointAt(0));
  nfdFirst.set(cp, nfd[0]);
  for (const c of nfd.slice(1)) nonInitial.add(c);
}

const unstable = [];
for (let cp = 0; cp <= MAX; cp++) {
  if (isSurrogate(cp)) continue;
  const s = String.fromCodePoint(cp);
  if (s.normalize('NFC') !== s || /\p{M}/u.test(s) || nonInitial.has(cp) || nonInitial.has(nfdFirst.get(cp))) {
    unstable.push(cp);
  }
}

const ranges = [];
for (const cp of unstable) {
  const last = ranges[ranges.length - 1];
  if (last && last[1] === cp - 1) last[1] = cp;
  else ranges.push([cp, cp]);
}

const hex = (n) => '0x' + n.toString(16).padStart(4, '0');
const r16 = ranges.filter(([, hi]) => hi <= 0xffff);
const r32 = ranges.filter(([lo]) => lo > 0xffff);
if (ranges.some(([lo, hi]) => lo <= 0xffff && hi > 0xffff)) throw new Error('rango que cruza 0xFFFF');

const out = [];
out.push('// Código generado por internal/protocol/gen/nfc.mjs. NO EDITAR.');
out.push(`// Node ${process.versions.node}, Unicode ${process.versions.unicode}, ICU ${process.versions.icu}.`);
out.push('');
out.push('package protocol');
out.push('');
out.push('import "unicode"');
out.push('');
out.push(`// nfcUnstable: ${unstable.length} caracteres en ${ranges.length} rangos.`);
out.push('var nfcUnstable = &unicode.RangeTable{');
out.push('\tR16: []unicode.Range16{');
for (const [lo, hi] of r16) out.push(`\t\t{Lo: ${hex(lo)}, Hi: ${hex(hi)}, Stride: 1},`);
out.push('\t},');
out.push('\tR32: []unicode.Range32{');
for (const [lo, hi] of r32) out.push(`\t\t{Lo: ${hex(lo)}, Hi: ${hex(hi)}, Stride: 1},`);
out.push('\t},');
out.push('}');
process.stdout.write(out.join('\n') + '\n');
