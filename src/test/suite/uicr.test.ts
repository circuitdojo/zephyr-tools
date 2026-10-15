import * as assert from "assert";
import { extractUicrWords, parseProbeRsRead32, planUicr, stripHexRange } from "../../build/uicr";

// uicr_debug_access_open.hex from the Feather nRF9151 board, plus an
// application record at 0x00020000.
const DEBUG_ACCESS_HEX = [
  ":020000040002F8",
  ":0400000001020304F2",
  ":0200000400FFFB",
  ":04800000FA50FA50E8",
  ":04802C00FA50FA50BC",
  ":00000001FF",
].join("\n");

suite("uicr", () => {
  test("extractUicrWords reads little-endian words in the UICR range only", () => {
    const words = extractUicrWords(DEBUG_ACCESS_HEX);
    assert.deepStrictEqual([...words.entries()], [
      [0x00ff8000, 0x50fa50fa],
      [0x00ff802c, 0x50fa50fa],
    ]);
  });

  test("stripHexRange removes UICR records and keeps everything else", () => {
    const stripped = stripHexRange(DEBUG_ACCESS_HEX);
    assert.strictEqual(extractUicrWords(stripped).size, 0);
    assert.ok(stripped.includes(":0400000001020304F2"));
    assert.ok(stripped.includes(":00000001FF"));
  });

  test("stripHexRange splits a record that straddles the range boundary", () => {
    // Four bytes at 0x00FF7FFE: two before UICR, two inside it.
    const hex = [":0200000400FFFB", ":047FFE00AABBCCDD71", ":00000001FF"].join("\n");
    const stripped = stripHexRange(hex);
    assert.ok(stripped.includes(":027FFE00AABB1C"), stripped);
    assert.strictEqual(extractUicrWords(stripped).size, 0);
  });

  test("parseProbeRsRead32 parses addressed rows", () => {
    const words = parseProbeRsRead32("00ff8000: 50fa50fa ffffffff\n00ff8008: 00000001\n", 0x00ff8000);
    assert.strictEqual(words.get(0x00ff8000), 0x50fa50fa);
    assert.strictEqual(words.get(0x00ff8004), 0xffffffff);
    assert.strictEqual(words.get(0x00ff8008), 1);
  });

  test("parseProbeRsRead32 parses probe-rs 0.29 unaddressed output", () => {
    const words = parseProbeRsRead32("50fa50fa ffffffff 00000001 \n", 0x00ff8000);
    assert.strictEqual(words.get(0x00ff8000), 0x50fa50fa);
    assert.strictEqual(words.get(0x00ff8008), 1);
    assert.strictEqual(words.size, 3);
  });

  test("planUicr skips when the device already holds every programmed word", () => {
    const hex = extractUicrWords(DEBUG_ACCESS_HEX);
    const device = parseProbeRsRead32("00ff8000: 50fa50fa\n00ff802c: 50fa50fa\n", 0x00ff8000);
    assert.deepStrictEqual(planUicr(hex, device), { action: "skip" });
  });

  test("planUicr ignores words the hex leaves erased (runtime counters)", () => {
    const hex = new Map([[0x00ff8000, 0x50fa50fa], [0x00ff8158, 0xffffffff]]);
    const device = new Map([[0x00ff8000, 0x50fa50fa], [0x00ff8158, 0xfffffffc]]);
    assert.deepStrictEqual(planUicr(hex, device), { action: "skip" });
  });

  test("planUicr erases when a word differs or is still blank", () => {
    const hex = new Map([[0x00ff8000, 0x50fa50fa], [0x00ff8140, 0x0c9007a0]]);
    const device = new Map([[0x00ff8000, 0xffffffff], [0x00ff8140, 0x4c1d9430]]);
    assert.deepStrictEqual(planUicr(hex, device), { action: "erase", addresses: [0x00ff8000, 0x00ff8140] });
  });

  test("planUicr does nothing for a hex without UICR", () => {
    assert.deepStrictEqual(planUicr(new Map(), new Map()), { action: "none" });
  });
});
