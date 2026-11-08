import * as assert from "assert";
import { hexHasData, readHexBytes, writeHex } from "../../build/intel-hex";

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

  test("hexHasData is false for a file with only address and EOF records", () => {
    assert.strictEqual(hexHasData(":0200000400FFFB\n:00000001FF\n"), false);
    assert.strictEqual(hexHasData(writeHex(new Map([[0, 1]]))), true);
  });
});
