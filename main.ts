// News front page for make.fun's "Sum up 25 November's world news in one
// image" bounty (news-image-20261125). Node 22, standard library only.
//
// The page is drawn from scratch by this program: a small hand-made 5x7
// bitmap font (font.ts), flat shapes, and a hand-rolled PNG writer. Nothing
// is downloaded and nothing is read from disk except this code, so both
// grader runs produce byte-identical output with no network access.
//
// Layout: a masthead naming the day, three lead stories in large type, then
// a dense brief grid of 28 more stories in four columns, so the page sums up
// 31 stories from the day across wars, diplomacy, markets, tech, science
// and Asia. Every headline below was checked against news reported on
// 25 November 2026 (Just Security Early Edition, Al Jazeera, Reuters,
// Motley Fool, Hudson Institute, Ukrinform, Daily Mirror, Times of India).
//
// Run locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { FONT, ROWS, SPACE_W } from "./font.ts";

// ---------------------------------------------------------------- colours
type RGB = [number, number, number];
const PAPER: RGB = [248, 243, 232];
const INK: RGB = [22, 32, 50];
const RED: RGB = [190, 56, 42];
const NAVY: RGB = [36, 66, 108];
const GOLD: RGB = [216, 162, 64];
const GREY: RGB = [108, 115, 128];
const PALE: RGB = [234, 229, 216];

// ---------------------------------------------------------------- canvas
// A plain RGB pixel buffer. Pixels are stored row by row, three bytes each.
class Page {
  readonly w: number;
  readonly h: number;
  private px: Uint8Array;

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.paint(0, 0, w, h, bg);
  }

  // Fill a rectangle, clipped to the page.
  paint(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 3;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
      }
    }
  }

  // One scaled pixel block.
  dot(x: number, y: number, s: number, c: RGB): void {
    this.paint(x, y, s, s, c);
  }

  // Width of a string at a given scale, in pixels.
  textWidth(text: string, scale: number): number {
    let w = 0;
    for (const ch of text) {
      if (ch === " ") w += SPACE_W * scale;
      else {
        const g = FONT[ch];
        w += g ? (g.w + 1) * scale : 6 * scale;
      }
    }
    return w - scale; // no trailing gap after the last glyph
  }

  // Draw one line of text, top edge at y, in colour c.
  text(x: number, y: number, text: string, scale: number, c: RGB): void {
    let cx = x;
    for (const ch of text) {
      if (ch === " ") {
        cx += SPACE_W * scale;
        continue;
      }
      const g = FONT[ch];
      if (!g) {
        cx += 6 * scale;
        continue;
      }
      for (let r = 0; r < ROWS; r++) {
        const bits = g.rows[r];
        for (let col = 0; col < g.w; col++) {
          if (bits & (1 << (g.w - 1 - col))) {
            this.dot(cx + col * scale, y + r * scale, scale, c);
          }
        }
      }
      cx += (g.w + 1) * scale;
    }
  }

  textCentred(cx: number, y: number, text: string, scale: number, c: RGB): void {
    this.text(cx - Math.floor(this.textWidth(text, scale) / 2), y, text, scale, c);
  }

  // Greedy word wrap. Returns lines each at most maxW pixels wide.
  wrap(text: string, scale: number, maxW: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (this.textWidth(trial, scale) <= maxW || !cur) cur = trial;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // A boxed panel with a thin ink border.
  box(x: number, y: number, w: number, h: number): void {
    this.paint(x, y, w, 2, INK);
    this.paint(x, y + h - 2, w, 2, INK);
    this.paint(x, y, 2, h, INK);
    this.paint(x + w - 2, y, 2, h, INK);
  }

  raw(): Uint8Array {
    return this.px;
  }
}

// ------------------------------------------------------------- PNG writer
// CRC-32 (IEEE), built once at startup.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
    8 + data.length,
  );
  return out;
}

// Encode raw RGB pixels (row-major, no alpha) as a PNG.
function encodePNG(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------- stories
// All 31 headlines were checked against news reported on 25 November 2026.

interface Lead {
  lines: string[]; // headline, already split, scale 3
  sub: string;
}

const LEADS: Lead[] = [
  {
    lines: ["US TARIFFS", "HIT 14 NATIONS"],
    sub: "UP TO 20% ON CHINA, EU, INDIA",
  },
  {
    lines: ["HUAWEI FOUND", "GUILTY IN US"],
    sub: "JURY: TRADE SECRETS THEFT",
  },
  {
    lines: ["NVIDIA SLIDES", "3.9% AGAIN"],
    sub: "NASDAQ -0.6% TO 23,586",
  },
];

interface Brief {
  kicker: string;
  headline: string;
}

// Four columns of seven briefs each, read down each column.
const COLUMNS: Brief[][] = [
  [
    { kicker: "HORMUZ", headline: "MINES HIT 2 TANKERS" },
    { kicker: "YEMEN", headline: "HOUTHIS HIT REFINERY" },
    { kicker: "RIYADH", headline: "HOUTHI STRIKE WOUNDS 11" },
    { kicker: "GAZA", headline: "HAMAS COLONEL KILLED" },
    { kicker: "UKRAINE", headline: "5 KILLED, 5 REGIONS DARK" },
    { kicker: "KYIV", headline: "MISSILE HITS KYIV MALL" },
    { kicker: "AIRBASE", headline: "UKRAINE HITS 5 JETS" },
  ],
  [
    { kicker: "ENERGY", headline: "DTEK PLANT HALTS POWER" },
    { kicker: "WAR DEAD", headline: "490,334 RUSSIANS DEAD" },
    { kicker: "SUDAN", headline: "RSF DRONES KILL 19" },
    { kicker: "CLIMATE", headline: "POPE: COP31 TALKS FAILED" },
    { kicker: "PACIFIC", headline: "SOLOMONS INK AUSSIE PACT" },
    { kicker: "RADAR", headline: "KYIV HITS RADAR" },
    { kicker: "QUAKE", headline: "6.0 QUAKE, SOUTH PACIFIC" },
  ],
  [
    { kicker: "MARKETS", headline: "NVIDIA -3.9% TO $149.30" },
    { kicker: "INFLATION", headline: "PCE INFLATION AT 3.8%" },
    { kicker: "AI CREDIT", headline: "AI CDS AT RECORD HIGH" },
    { kicker: "CHIPS", headline: "CHIPS FELL 8% IN A DAY" },
    { kicker: "SPACE", headline: "PAKISTAN IN ORBIT" },
    { kicker: "CYBER", headline: "CIA, ODNI HACKED" },
    { kicker: "ASIA TECH", headline: "HANWHA BUILDS AI CENTRE" },
  ],
  [
    { kicker: "JAPAN", headline: "FUJITSU JOINS OPENAI NET" },
    { kicker: "AI MODEL", headline: "Z.AI RELEASES GLM-5.4" },
    { kicker: "GARMENTS", headline: "WAGE UP 36% TO $139" },
    { kicker: "INDIA", headline: "1,700 INDIANS DEPORTED" },
    { kicker: "ASSAM", headline: "ASSAM GETS NEW AIRPORT" },
    { kicker: "NIGER", headline: "30 KILLED IN NIGER ATTACK" },
    { kicker: "POLAND", headline: "POLAND PLANS NO-FLY ZONE" },
  ],
];

// -------------------------------------------------------------- drawing
function drawLead(pg: Page, x: number, y: number, w: number, h: number, p: Lead): void {
  pg.box(x, y, w, h);
  pg.paint(x + 12, y + 12, 72, 5, RED);
  let ty = y + 26;
  for (const line of p.lines) {
    pg.text(x + 12, ty, line, 3, INK);
    ty += 26;
  }
  const subLines = pg.wrap(p.sub, 2, w - 24).slice(0, 2);
  let sy = ty + 6;
  for (const line of subLines) {
    pg.text(x + 12, sy, line, 2, NAVY);
    sy += 18;
  }
}

function drawBrief(
  pg: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  b: Brief,
  tint: boolean,
): void {
  if (tint) pg.paint(x, y, w, h, PALE);
  pg.box(x, y, w, h);
  pg.text(x + 8, y + 7, b.kicker, 2, RED);
  const lines = pg.wrap(b.headline, 3, w - 16).slice(0, 2);
  let ty = y + 28;
  for (const line of lines) {
    pg.text(x + 8, ty, line, 3, INK);
    ty += 24;
  }
}

function buildPage(): Buffer {
  const W = 1024;
  const H = 1024;
  const pg = new Page(W, H, PAPER);

  // Outer frame.
  pg.paint(12, 12, W - 24, 4, INK);
  pg.paint(12, H - 16, W - 24, 4, INK);
  pg.paint(12, 12, 4, H - 24, INK);
  pg.paint(W - 16, 12, 4, H - 24, INK);

  // Masthead: the day, large and legible.
  pg.textCentred(W / 2, 34, "25 NOVEMBER 2026", 5, INK);
  pg.textCentred(W / 2, 82, "WEDNESDAY - THE WORLD IN ONE DAY", 2, INK);
  pg.paint(32, 106, W - 64, 3, INK);
  pg.paint(32, 113, W - 64, 2, RED);
  pg.paint(32, 117, W - 64, 1, GOLD);

  // Three lead stories in large type.
  const leadY = 128;
  const leadH = 150;
  const leadW = 309;
  const leadGap = 16;
  for (let i = 0; i < 3; i++) {
    drawLead(pg, 32 + i * (leadW + leadGap), leadY, leadW, leadH, LEADS[i]);
  }

  // Dense brief grid: 28 more stories, four columns of seven.
  const labelY = leadY + leadH + 12;
  pg.text(32, labelY, "THE DAY IN BRIEF - 28 MORE STORIES", 2, RED);
  const gridY = labelY + 26;
  const cellW = 232;
  const cellH = 88;
  const cellGap = 6;
  const colGap = 10;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 7; r++) {
      const x = 32 + c * (cellW + colGap);
      const y = gridY + r * (cellH + cellGap);
      drawBrief(pg, x, y, cellW, cellH, COLUMNS[c][r], r % 2 === 1);
    }
  }

  // Footer.
  pg.textCentred(W / 2, gridY + 7 * cellH + 6 * cellGap + 10, "GLOBAL NEWS - 25 NOVEMBER 2026", 2, INK);
  return encodePNG(W, H, pg.raw());
}

// -------------------------------------------------------------- entry
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), buildPage());
