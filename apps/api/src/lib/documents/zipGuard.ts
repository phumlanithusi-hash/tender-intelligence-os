import { MAX_DECOMPRESSED_SIZE_BYTES } from '@tender-os/constants'

/**
 * Decompression-bomb defence for zip-container formats (Phase 6 §33:
 * "DOCX/XLSX/PPTX are zip containers — guard against a maliciously
 * crafted archive expanding to gigabytes"). Reads only the ZIP
 * central directory (a small, fixed-format index at the end of the
 * archive) to sum every entry's DECLARED uncompressed size, without
 * decompressing anything — so a bomb is rejected before any real
 * unzip work (by mammoth/exceljs) ever begins. This is a pure binary
 * parser, not a zip decompressor: it never executes archive content.
 *
 * Declared sizes can themselves be forged, so this is a defence layer
 * (cheap, fast, rejects the obvious/declared case) alongside the
 * caller's own overall output-size sanity checks — not the only line
 * of defence.
 */
export function assertZipNotABomb(bytes: Buffer, maxDecompressedBytes = MAX_DECOMPRESSED_SIZE_BYTES): void {
  const eocd = findEndOfCentralDirectory(bytes)
  if (!eocd) {
    // Not a well-formed zip at all — let the real parser fail on it
    // rather than guessing; this guard only rejects understood bombs.
    return
  }

  let offset = eocd.centralDirectoryOffset
  let totalUncompressed = 0
  let entriesSeen = 0

  while (offset + 46 <= bytes.length && entriesSeen < eocd.totalEntries) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) break // central directory file header signature
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLen = bytes.readUInt16LE(offset + 28)
    const extraLen = bytes.readUInt16LE(offset + 30)
    const commentLen = bytes.readUInt16LE(offset + 32)

    totalUncompressed += uncompressedSize
    if (totalUncompressed > maxDecompressedBytes) {
      throw new Error(
        `Archive's declared uncompressed size exceeds the ${maxDecompressedBytes}-byte limit — refusing to expand (possible decompression bomb).`,
      )
    }

    offset += 46 + nameLen + extraLen + commentLen
    entriesSeen += 1
  }
}

function findEndOfCentralDirectory(
  bytes: Buffer,
): { centralDirectoryOffset: number; totalEntries: number } | null {
  const searchStart = Math.max(0, bytes.length - 65557) // max comment length + EOCD record size
  for (let i = bytes.length - 22; i >= searchStart; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      return {
        totalEntries: bytes.readUInt16LE(i + 10),
        centralDirectoryOffset: bytes.readUInt32LE(i + 16),
      }
    }
  }
  return null
}
