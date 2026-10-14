import * as assert from "assert";
import { hexHasData, hexRanges, mergeHexTexts, readHexBytes, writeHex } from "../../build/intel-hex";

suite("intel-hex", () => {
  test("writeHex round-trips bytes across a 64 KiB boundary", () => {
    const bytes = new Map<number, number>();
    for (let i = 0; i < 40; i++) {
      bytes.set(0x0000fff0 + i, i);
    }
    bytes.set(0x00ff8000, 0xfa);
    const text = writeHex(bytes);
    assert.deepStrictEqual(readHexBytes(text), bytes);
    // No data record may cross into the next 64 KiB page.
    assert.ok(text.includes(":020000040001F9"));
    assert.ok(text.trim().endsWith(":00000001FF"));
  });

  test("mergeHexTexts lets later files replace earlier data", () => {
    const a = writeHex(new Map([[0x100, 1], [0x101, 2]]));
    const b = writeHex(new Map([[0x101, 9], [0x102, 3]]));
    assert.deepStrictEqual(readHexBytes(mergeHexTexts([a, b])), new Map([[0x100, 1], [0x101, 9], [0x102, 3]]));
  });

  test("hexRanges coalesces contiguous records", () => {
    const text = writeHex(new Map(Array.from({ length: 40 }, (_, i) => [0x200 + i, 0] as [number, number])));
    assert.deepStrictEqual(hexRanges(text), [[0x200, 0x228]]);
  });

  test("hexHasData is false for a file with only address and EOF records", () => {
    assert.strictEqual(hexHasData(":0200000400FFFB\n:00000001FF\n"), false);
    assert.strictEqual(hexHasData(writeHex(new Map([[0, 1]]))), true);
  });
});
