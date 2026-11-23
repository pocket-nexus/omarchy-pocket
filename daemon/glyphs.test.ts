// The applets' glyphs service: which characters an atlas holds, and the bold
// of a face that has one weight (daemon/glyphs.ts).
import { describe, expect, test } from "bun:test";
import { atlasCodepoints, emboldenAtlas } from "./glyphs.ts";

/** A FONT ATLAS v3 of `rows` (one string per glyph row, "#" inked), glyph 0 a full box. */
function atlas(cellW: number, cellH: number, density: number, lineHeight: number, glyphs: string[][]): Uint8Array {
  const w = cellW * density;
  const h = cellH * density;
  const count = glyphs.length + 1;
  const out = new Uint8Array(16 + count * 8 + count * w * h);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x41464344, true);
  view.setUint16(4, 3, true);
  view.setUint16(6, count, true);
  out.set([cellW, cellH, cellH - 1, lineHeight, 22, 1, density, 0], 8);
  const cells = 16 + count * 8;
  out.fill(255, cells, cells + w * h);
  glyphs.forEach((rows, index) => {
    const entry = 16 + index * 8;
    view.setUint32(entry, 0x4e00 + index, true);
    view.setUint16(entry + 4, index + 1, true);
    out[entry + 6] = cellW;
    rows.forEach((row, y) => [...row].forEach((ch, x) => (out[cells + (index + 1) * w * h + y * w + x] = ch === "#" ? 255 : ch === "+" ? 128 : 0)));
  });
  return out;
}
const rowsOf = (bytes: Uint8Array, gid: number, w: number, h: number) => {
  const count = new DataView(bytes.buffer).getUint16(6, true);
  const cell = 16 + count * 8 + gid * w * h;
  return Array.from({ length: h }, (_, y) => [...bytes.subarray(cell + y * w, cell + (y + 1) * w)].map((v) => (v === 255 ? "#" : v === 128 ? "+" : ".")).join(""));
};

describe("atlasCodepoints", () => {
  test("printable ASCII rides along unless the request declines it", () => {
    expect(atlasCodepoints("你好", true).length).toBe(95 + 2);
    expect(atlasCodepoints("你好", false)).toEqual([0x4f60, 0x597d]);
    expect(atlasCodepoints("", false)).toEqual([]);
  });
  test("each character once, ascending, control characters left out", () => {
    expect(atlasCodepoints("好你\n好 A\t😀", false)).toEqual([0x20, 0x41, 0x4f60, 0x597d, 0x1f600]);
  });
});

describe("emboldenAtlas", () => {
  test("a stroke grows by the spread, half to each side", () => {
    const regular = atlas(8, 3, 1, 4, [["...#....", "..+#....", "........"]]);
    expect(rowsOf(emboldenAtlas(regular, 2), 1, 8, 3)).toEqual(["..###...", ".+###...", "........"]);
    // one pixel goes to the right
    expect(rowsOf(emboldenAtlas(regular, 1), 1, 8, 3)).toEqual(["...##...", "..+##...", "........"]);
  });
  test("ink stays inside its cell and its row", () => {
    const regular = atlas(4, 2, 1, 3, [["#...", "...#"], ["....", "#..."]]);
    const bold = emboldenAtlas(regular, 2);
    expect(rowsOf(bold, 1, 4, 2)).toEqual(["##..", "..##"]);
    expect(rowsOf(bold, 2, 4, 2)).toEqual(["....", "##.."]);
  });
  test("the header, the cmap and the missing-character box are untouched", () => {
    const regular = atlas(4, 2, 2, 3, [["#.......", "........", "........", "........"]]);
    const bold = emboldenAtlas(regular);
    expect([...bold.subarray(0, 16 + 2 * 8)]).toEqual([...regular.subarray(0, 16 + 2 * 8)]);
    expect(rowsOf(bold, 0, 8, 4)).toEqual(rowsOf(regular, 0, 8, 4));
    expect(bold.length).toBe(regular.length);
    // the source is not written to
    expect(rowsOf(regular, 1, 8, 4)[0]).toBe("#.......");
  });
  test("by default a twentieth of the size in device pixels, at least one", () => {
    // line height 17 is a 13 px face: two device pixels at density 3, one at density 1
    const dense = atlas(4, 1, 3, 17, [["......#.....", "............", "............"]]);
    expect(rowsOf(emboldenAtlas(dense), 1, 12, 3)[0]).toBe(".....###....");
    const plain = atlas(6, 1, 1, 17, [["..#..."]]);
    expect(rowsOf(emboldenAtlas(plain), 1, 6, 1)[0]).toBe("..##..");
  });
  test("what is not an atlas comes back as it was", () => {
    const short = new Uint8Array([1, 2, 3]);
    expect(emboldenAtlas(short)).toBe(short);
  });
});
