'use strict';
/*
 * Minimalny odczyt i zapis PNG bez zaleznosci (sam zlib z Node). Dla grafik marki:
 *   czytaj(bufor)   -> { szer, wys, typ, piksel(x, y) -> [r, g, b, a] }  (8 bitow, RGB/RGBA/szarosc/paleta, bez przeplotu;
 *                      typ to typ koloru PNG: 2 RGB, 6 RGBA, 3 paleta, 0 i 4 szarosc)
 *   bezAlfy(bufor)  -> PNG RGB z PNG RGBA (ikony iOS i maskable nie moga miec kanalu alfa)
 */

const zlib = require('zlib');

const SYGNATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KANALY = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bufor) {
  let c = 0xffffffff;
  for (const b of bufor) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function kawalki(bufor) {
  if (!bufor.subarray(0, 8).equals(SYGNATURA)) throw new Error('to nie jest plik PNG');
  const wynik = [];
  for (let i = 8; i < bufor.length;) {
    const dl = bufor.readUInt32BE(i);
    wynik.push({ typ: bufor.toString('latin1', i + 4, i + 8), dane: bufor.subarray(i + 8, i + 8 + dl) });
    i += 12 + dl;
  }
  return wynik;
}

// Odwraca filtry wierszy PNG (0-4). bpp: bajty na piksel.
function odfiltruj(surowe, szer, wys, bpp) {
  const wiersz = szer * bpp;
  const wyj = Buffer.alloc(wiersz * wys);
  for (let y = 0; y < wys; y++) {
    const filtr = surowe[y * (wiersz + 1)];
    const we = y * (wiersz + 1) + 1, cel = y * wiersz, pop = cel - wiersz;
    for (let x = 0; x < wiersz; x++) {
      const a = x >= bpp ? wyj[cel + x - bpp] : 0, b = y ? wyj[pop + x] : 0, c = x >= bpp && y ? wyj[pop + x - bpp] : 0;
      let p = 0;
      if (filtr === 1) p = a;
      else if (filtr === 2) p = b;
      else if (filtr === 3) p = (a + b) >> 1;
      else if (filtr === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filtr !== 0) throw new Error('nieznany filtr PNG ' + filtr);
      wyj[cel + x] = (surowe[we + x] + p) & 0xff;
    }
  }
  return wyj;
}

function czytaj(bufor) {
  const k = kawalki(bufor);
  const ihdr = k.find((c) => c.typ === 'IHDR').dane;
  const szer = ihdr.readUInt32BE(0), wys = ihdr.readUInt32BE(4), glebia = ihdr[8], typ = ihdr[9], przeplot = ihdr[12];
  if (glebia !== 8 || !(typ in KANALY) || przeplot) throw new Error(`nieobslugiwany PNG (glebia ${glebia}, typ ${typ}, przeplot ${przeplot})`);
  const bpp = KANALY[typ];
  const dane = odfiltruj(zlib.inflateSync(Buffer.concat(k.filter((c) => c.typ === 'IDAT').map((c) => c.dane))), szer, wys, bpp);
  const plte = (k.find((c) => c.typ === 'PLTE') || {}).dane;
  const trns = (k.find((c) => c.typ === 'tRNS') || {}).dane;
  const piksel = (x, y) => {
    const i = (y * szer + x) * bpp;
    if (typ === 6) return [dane[i], dane[i + 1], dane[i + 2], dane[i + 3]];
    if (typ === 2) return [dane[i], dane[i + 1], dane[i + 2], 255];
    if (typ === 4) return [dane[i], dane[i], dane[i], dane[i + 1]];
    if (typ === 0) return [dane[i], dane[i], dane[i], 255];
    const n = dane[i];
    return [plte[n * 3], plte[n * 3 + 1], plte[n * 3 + 2], trns && n < trns.length ? trns[n] : 255];
  };
  return { szer, wys, typ, piksel };
}

function kawalek(typ, dane) {
  const dl = Buffer.alloc(4); dl.writeUInt32BE(dane.length);
  const td = Buffer.concat([Buffer.from(typ, 'latin1'), dane]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([dl, td, crc]);
}

function bezAlfy(bufor) {
  const { szer, wys, piksel } = czytaj(bufor);
  const surowe = Buffer.alloc((szer * 3 + 1) * wys);
  for (let y = 0; y < wys; y++) {
    for (let x = 0; x < szer; x++) {
      const [r, g, b, a] = piksel(x, y);
      if (a !== 255) throw new Error(`piksel ${x},${y} jest przezroczysty: ikona bez alfy potrzebuje pelnego tla`);
      surowe.set([r, g, b], y * (szer * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(szer, 0); ihdr.writeUInt32BE(wys, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SYGNATURA, kawalek('IHDR', ihdr), kawalek('IDAT', zlib.deflateSync(surowe, { level: 9 })), kawalek('IEND', Buffer.alloc(0))]);
}

module.exports = { czytaj, bezAlfy };
