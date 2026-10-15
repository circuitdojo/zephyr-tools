/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/**
 * nRF91 UICR handling for probe-rs flashing.
 *
 * NCS 3.5+ builds with b0 write UICR (b0 provisioning data, and on the
 * Feathers the debug access words). On nRF91 UICR can only be cleared by a
 * full chip erase, and probe-rs fails to program a UICR word that is already
 * written, even with the same value. So before flashing, the device's UICR is
 * compared with the hex: if everything the hex programs is already there, the
 * UICR records are stripped from the download; otherwise the chip must be
 * erased first.
 */

import { forEachRecord, formatDataRecord } from "./intel-hex";

export const NRF91_UICR_START = 0x00ff8000;
export const NRF91_UICR_SIZE = 0x1000;

const ERASED_WORD = 0xffffffff;

/** Word-aligned address -> 32-bit little-endian value. */
export type UicrWords = Map<number, number>;

function inRange(address: number, start: number, size: number): boolean {
  return address >= start && address < start + size;
}

/**
 * UICR words programmed by a hex file. Bytes of a word that the hex does not
 * set are left erased (0xFF).
 */
export function extractUicrWords(hexText: string, start = NRF91_UICR_START, size = NRF91_UICR_SIZE): UicrWords {
  const words: UicrWords = new Map();
  forEachRecord(hexText, (_line, record, base) => {
    if (record?.type !== 0x00) {
      return;
    }
    record.data.forEach((byte, i) => {
      const address = base + record.offset + i;
      if (!inRange(address, start, size)) {
        return;
      }
      const wordAddress = address & ~3;
      const shift = (address & 3) * 8;
      const current = words.get(wordAddress) ?? ERASED_WORD;
      words.set(wordAddress, ((current & ~(0xff << shift)) | (byte << shift)) >>> 0);
    });
  });
  return words;
}

/** Remove every data byte in [start, start + size) from a hex file. */
export function stripHexRange(hexText: string, start = NRF91_UICR_START, size = NRF91_UICR_SIZE): string {
  const out: string[] = [];
  forEachRecord(hexText, (line, record, base) => {
    if (record?.type !== 0x00) {
      out.push(line);
      return;
    }
    // Keep runs of bytes outside the range, each as its own record.
    let runOffset = -1;
    let run: number[] = [];
    const flush = () => {
      if (run.length > 0) {
        out.push(formatDataRecord(runOffset, run));
      }
      run = [];
    };
    record.data.forEach((byte, i) => {
      if (inRange(base + record.offset + i, start, size)) {
        flush();
        return;
      }
      if (run.length === 0) {
        runOffset = record.offset + i;
      }
      run.push(byte);
    });
    flush();
  });
  return out.join("\n");
}

/**
 * Parse `probe-rs read b32 <start> <count>` output. Newer probe-rs prints
 * addressed rows (`00ff8000: 50fa50fa ffffffff ...`); 0.29 prints the words
 * space-separated with no addresses, counted from `start`.
 */
export function parseProbeRsRead32(stdout: string, start: number): UicrWords {
  const words: UicrWords = new Map();
  let address = start;
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*([0-9a-fA-F]+):\s+(.*)$/.exec(line);
    if (match) {
      address = parseInt(match[1], 16);
    }
    const values = (match ? match[2] : line).trim();
    if (values === "") {
      continue;
    }
    for (const value of values.split(/\s+/)) {
      words.set(address, parseInt(value, 16) >>> 0);
      address += 4;
    }
  }
  return words;
}

export type UicrPlan =
  /** The hex does not program UICR. */
  | { action: "none" }
  /** Everything the hex programs is already on the device; strip UICR from the download. */
  | { action: "skip" }
  /** UICR words must be written; a full chip erase is required first. */
  | { action: "erase"; addresses: number[] };

/**
 * Decide how to flash UICR. Words the hex leaves erased are ignored, so values
 * the firmware writes at runtime (e.g. b0's monotonic counter slots) don't
 * force an erase. Any word still to be written needs an erase, since probe-rs
 * can't program UICR once it is non-blank.
 */
export function planUicr(hexWords: UicrWords, deviceWords: UicrWords): UicrPlan {
  if (hexWords.size === 0) {
    return { action: "none" };
  }
  const addresses: number[] = [];
  for (const [address, value] of hexWords) {
    if (value === ERASED_WORD) {
      continue;
    }
    if (deviceWords.get(address) !== value) {
      addresses.push(address);
    }
  }
  if (addresses.length === 0) {
    return { action: "skip" };
  }
  return { action: "erase", addresses: addresses.sort((a, b) => a - b) };
}
