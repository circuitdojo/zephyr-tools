/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/** Minimal Intel HEX reading and writing for flash preparation. */

export interface HexRecord {
  type: number;
  offset: number;
  data: number[];
}

/** Absolute address -> byte. */
export type HexBytes = Map<number, number>;

export function parseRecord(line: string): HexRecord | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(":")) {
    return null;
  }
  const bytes: number[] = [];
  for (let i = 1; i + 1 < trimmed.length; i += 2) {
    bytes.push(parseInt(trimmed.substring(i, i + 2), 16));
  }
  const length = bytes[0];
  return {
    type: bytes[3],
    offset: (bytes[1] << 8) | bytes[2],
    data: bytes.slice(4, 4 + length),
  };
}

function formatRecord(type: number, offset: number, data: number[]): string {
  const bytes = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
  const sum = bytes.reduce((acc, b) => acc + b, 0);
  const checksum = (0x100 - (sum & 0xff)) & 0xff;
  return ":" + [...bytes, checksum].map(b => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function formatDataRecord(offset: number, data: number[]): string {
  return formatRecord(0x00, offset, data);
}

/**
 * Walk the lines of an Intel HEX file. The callback gets each line, its parsed
 * record (null for non-record lines) and the base address in effect for it;
 * extended segment (02) and extended linear (04) address records update the
 * base address.
 */
export function forEachRecord(
  hexText: string,
  onLine: (line: string, record: HexRecord | null, base: number) => void
): void {
  let base = 0;
  for (const line of hexText.split(/\r?\n/)) {
    const record = parseRecord(line);
    if (record?.type === 0x02) {
      base = ((record.data[0] << 8) | record.data[1]) << 4;
    } else if (record?.type === 0x04) {
      base = ((record.data[0] << 8) | record.data[1]) << 16;
    }
    onLine(line, record, base);
  }
}

/** Every data byte in a hex file by absolute address. */
export function readHexBytes(hexText: string): HexBytes {
  const bytes: HexBytes = new Map();
  forEachRecord(hexText, (_line, record, base) => {
    if (record?.type !== 0x00) {
      return;
    }
    record.data.forEach((byte, i) => bytes.set(base + record.offset + i, byte));
  });
  return bytes;
}

/** Whether a hex file contains any data bytes. */
export function hexHasData(hexText: string): boolean {
  let found = false;
  forEachRecord(hexText, (_line, record) => {
    if (record?.type === 0x00 && record.data.length > 0) {
      found = true;
    }
  });
  return found;
}

/** Serialize bytes as Intel HEX with 16-byte data records. */
export function writeHex(bytes: HexBytes): string {
  const addresses = [...bytes.keys()].sort((a, b) => a - b);
  const lines: string[] = [];
  let upper = -1;
  let i = 0;
  while (i < addresses.length) {
    const start = addresses[i];
    const chunk: number[] = [bytes.get(start)!];
    // Extend while contiguous, within 16 bytes and within the same 64 KiB page.
    while (
      i + chunk.length < addresses.length &&
      chunk.length < 16 &&
      addresses[i + chunk.length] === start + chunk.length &&
      ((start + chunk.length) & 0xffff) !== 0
    ) {
      chunk.push(bytes.get(start + chunk.length)!);
    }
    const startUpper = Math.floor(start / 0x10000);
    if (startUpper !== upper) {
      lines.push(formatRecord(0x04, 0, [(startUpper >> 8) & 0xff, startUpper & 0xff]));
      upper = startUpper;
    }
    lines.push(formatDataRecord(start & 0xffff, chunk));
    i += chunk.length;
  }
  lines.push(":00000001FF");
  return lines.join("\n") + "\n";
}
