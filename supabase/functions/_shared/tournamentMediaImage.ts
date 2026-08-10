// supabase/functions/_shared/tournamentMediaImage.ts
//
// Server-side content verification and metadata sanitisation for the
// Multimedia pipeline. No dependencies, no network, no dynamic imports.
//
// WHAT THIS MODULE ACTUALLY DOES (and what it does not) — the honest version,
// because `uploadReady` is derived from these claims:
//
//   * It sniffs the real container from magic bytes. A `.png` named JPEG, an
//     SVG, an HTML polyglot or a ZIP never passes as an image.
//   * It walks the entire container structure to its terminator: every JPEG
//     segment plus the entropy-coded scan, every PNG chunk *including CRC
//     verification of each one*, every RIFF/WebP chunk. Truncated, padded and
//     trailing-byte files are rejected.
//   * It reads the true pixel dimensions out of the bitstream headers (SOFn /
//     IHDR / VP8|VP8L|VP8X). Client-declared dimensions are never used.
//   * It removes every metadata carrier: EXIF, XMP, IPTC, ICC, PNG text
//     chunks, JPEG comments — and reports what it found.
//   * It rejects animation (APNG, WebP ANIM) and unknown critical PNG chunks.
//
//   * It does NOT decode pixels. A file whose structure is valid but whose
//     entropy-coded payload is semantically broken is accepted here and will
//     simply render badly. Rejecting those requires a real codec.
//   * It does NOT re-encode. Pixel transcoding is the `pixelTranscode`
//     capability, which this release reports as `false`.
//   * It is NOT an antivirus. `antivirusScanning` is reported as `false`.
//
// Because there is no re-encode, sanitisation is enforced rather than applied:
// callers upload bytes that are already free of metadata (a canvas re-encode
// produces exactly that), and a strip that changes a single byte is treated as
// a rejected upload. That keeps the checksum, the byte size and the stored
// object identical to what was verified.

import {
  MEDIA_ALLOWED_MIME,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_FILE_BYTES,
  MEDIA_MAX_PIXELS,
  type MediaMime,
} from "./tournamentMediaContract.ts"

export type MediaImageErrorCode =
  | "MEDIA_EMPTY"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_MIME_UNSUPPORTED"
  | "MEDIA_MIME_MISMATCH"
  | "MEDIA_CONTENT_CORRUPT"
  | "MEDIA_TRAILING_BYTES"
  | "MEDIA_DIMENSIONS_INVALID"
  | "MEDIA_ANIMATION_UNSUPPORTED"
  | "MEDIA_UNKNOWN_CRITICAL_CHUNK"
  | "MEDIA_ORIENTATION_NOT_NORMALIZED"
  | "MEDIA_METADATA_PRESENT"

export class MediaImageError extends Error {
  readonly code: MediaImageErrorCode
  constructor(code: MediaImageErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
    this.name = "MediaImageError"
  }
}

export type MediaImageInspection = {
  mime: MediaMime
  width: number
  height: number
  byteSize: number
  /** EXIF orientation tag when the container carried one, else null. */
  exifOrientation: number | null
  /** Human-readable names of the metadata carriers that were found. */
  metadataFound: string[]
  /** The bytes with every metadata carrier removed. */
  sanitized: Uint8Array
  /** True when sanitising was a no-op, i.e. the input was already clean. */
  alreadyClean: boolean
}

export type MediaImageLimits = {
  maxFileBytes: number
  maxPixels: number
  maxEdge: number
}

const EXTERNAL_PROCESSOR_LIMITS: MediaImageLimits = {
  maxFileBytes: MEDIA_MAX_FILE_BYTES,
  maxPixels: MEDIA_MAX_PIXELS,
  maxEdge: MEDIA_MAX_EDGE,
}

const SVG_HINT = /<svg[\s>]|<!doctype\s+svg|<\?xml/i

function be16(bytes: Uint8Array, at: number) {
  return (bytes[at] << 8) | bytes[at + 1]
}
function be32(bytes: Uint8Array, at: number) {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
}
function le16(bytes: Uint8Array, at: number) {
  return bytes[at] | (bytes[at + 1] << 8)
}
function le24(bytes: Uint8Array, at: number) {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
}
function le32(bytes: Uint8Array, at: number) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
}
function ascii(bytes: Uint8Array, at: number, length: number) {
  let out = ""
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[at + i])
  return out
}
function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// Magic bytes
// ---------------------------------------------------------------------------

export function sniffImageMime(bytes: Uint8Array): MediaMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** Markers that carry a Start Of Frame, i.e. the real dimensions. */
function isStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/** APP0 (JFIF) and APP14 (Adobe colour transform) are kept: dropping them can
 *  change how a decoder renders the image. Everything else in the APP range
 *  plus COM is metadata and goes. */
function isStrippableJpegSegment(marker: number) {
  if (marker === 0xfe) return true // COM
  if (marker < 0xe0 || marker > 0xef) return false
  return marker !== 0xe0 && marker !== 0xee
}

function jpegSegmentName(marker: number) {
  if (marker === 0xfe) return "JPEG:COM"
  return `JPEG:APP${marker - 0xe0}`
}

function readExifOrientation(payload: Uint8Array): number | null {
  // payload starts right after the segment length, i.e. at "Exif\0\0".
  if (payload.length < 14 || ascii(payload, 0, 4) !== "Exif") return null
  const tiff = payload.subarray(6)
  if (tiff.length < 8) return null
  const byteOrder = ascii(tiff, 0, 2)
  const little = byteOrder === "II"
  if (!little && byteOrder !== "MM") return null
  const u16 = (at: number) => (little ? le16(tiff, at) : be16(tiff, at))
  const u32 = (at: number) => (little ? le32(tiff, at) : be32(tiff, at))
  if (u16(2) !== 0x002a) return null
  const ifdOffset = u32(4)
  if (ifdOffset + 2 > tiff.length) return null
  const entries = u16(ifdOffset)
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

function inspectJpeg(bytes: Uint8Array): Omit<MediaImageInspection, "mime" | "byteSize"> {
  const kept: Uint8Array[] = []
  const metadataFound: string[] = []
  let orientation: number | null = null
  let width = 0
  let height = 0
  let sawScan = false
  let cursor = 0

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "missing SOI")
  }
  kept.push(bytes.subarray(0, 2))
  cursor = 2

  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", `expected marker at ${cursor}`)
    }
    let markerAt = cursor
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1
    if (markerAt >= bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "truncated marker")
    }
    const marker = bytes[markerAt]
    const headerStart = markerAt - 1

    if (marker === 0xd9) {
      kept.push(bytes.subarray(headerStart, markerAt + 1))
      cursor = markerAt + 1
      if (cursor !== bytes.length) {
        throw new MediaImageError("MEDIA_TRAILING_BYTES", `${bytes.length - cursor} bytes after EOI`)
      }
      if (!sawScan || width < 1 || height < 1) {
        throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "no scan or no frame header")
      }
      return {
        width,
        height,
        exifOrientation: orientation,
        metadataFound,
        sanitized: concat(kept),
        alreadyClean: metadataFound.length === 0,
      }
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(headerStart, markerAt + 1))
      cursor = markerAt + 1
      continue
    }
    if (markerAt + 3 > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "truncated segment length")
    }
    const length = be16(bytes, markerAt + 1)
    if (length < 2) throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "segment length < 2")
    const segmentEnd = markerAt + 1 + length
    if (segmentEnd > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "segment overruns file")
    }

    if (isStartOfFrame(marker)) {
      if (length < 8) throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "short SOF")
      height = be16(bytes, markerAt + 4)
      width = be16(bytes, markerAt + 6)
    }
    if (marker === 0xe1) {
      const payload = bytes.subarray(markerAt + 3, segmentEnd)
      const found = readExifOrientation(payload)
      if (found !== null) orientation = found
    }
    if (isStrippableJpegSegment(marker)) {
      metadataFound.push(jpegSegmentName(marker))
      cursor = segmentEnd
      continue
    }

    kept.push(bytes.subarray(headerStart, segmentEnd))

    if (marker === 0xda) {
      // Entropy-coded data: copy verbatim until the next real marker. 0xFF00 is
      // a stuffed byte and RSTn are in-stream restarts, neither ends the scan.
      sawScan = true
      let scan = segmentEnd
      while (scan < bytes.length) {
        if (bytes[scan] !== 0xff) {
          scan += 1
          continue
        }
        const next = bytes[scan + 1]
        if (next === undefined) {
          throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "truncated scan")
        }
        if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
          scan += next === 0xff ? 1 : 2
          continue
        }
        break
      }
      if (scan >= bytes.length) {
        throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "scan without EOI")
      }
      kept.push(bytes.subarray(segmentEnd, scan))
      cursor = scan
      continue
    }
    cursor = segmentEnd
  }
  throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "no EOI")
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Critical chunks plus the ancillary chunks that affect rendering. */
const PNG_KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND",
  "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "hIST", "pHYs",
])
/** Metadata carriers. Removing them changes nothing a viewer can see. */
const PNG_STRIP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP", "tIME", "sPLT"])
/** Animation. Out of scope for this MVP, and never silently flattened. */
const PNG_ANIMATION = new Set(["acTL", "fcTL", "fdAT"])

function inspectPng(bytes: Uint8Array): Omit<MediaImageInspection, "mime" | "byteSize"> {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)]
  const metadataFound: string[] = []
  let width = 0
  let height = 0
  let sawHeader = false
  let sawData = false
  let cursor = 8

  while (cursor < bytes.length) {
    if (cursor + 12 > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "truncated chunk header")
    }
    const length = be32(bytes, cursor)
    if (length > 0x7fffffff) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "absurd chunk length")
    }
    const type = ascii(bytes, cursor + 4, 4)
    const dataStart = cursor + 8
    const crcAt = dataStart + length
    if (crcAt + 4 > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", `chunk ${type} overruns file`)
    }
    if (crc32(bytes.subarray(cursor + 4, crcAt)) !== be32(bytes, crcAt)) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", `bad CRC on ${type}`)
    }
    const chunkEnd = crcAt + 4

    if (PNG_ANIMATION.has(type)) {
      throw new MediaImageError("MEDIA_ANIMATION_UNSUPPORTED", type)
    }
    if (type === "IHDR") {
      if (length < 13) throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "short IHDR")
      width = be32(bytes, dataStart)
      height = be32(bytes, dataStart + 4)
      sawHeader = true
    }
    if (type === "IDAT") sawData = true

    if (PNG_STRIP.has(type)) {
      metadataFound.push(`PNG:${type}`)
    } else if (PNG_KEEP.has(type)) {
      kept.push(bytes.subarray(cursor, chunkEnd))
    } else {
      // Bit 5 of the first byte clear => critical chunk. An unknown critical
      // chunk means a decoder feature we have not reviewed.
      const critical = (bytes[cursor + 4] & 0x20) === 0
      if (critical) throw new MediaImageError("MEDIA_UNKNOWN_CRITICAL_CHUNK", type)
      metadataFound.push(`PNG:${type}`)
    }

    cursor = chunkEnd
    if (type === "IEND") {
      if (cursor !== bytes.length) {
        throw new MediaImageError("MEDIA_TRAILING_BYTES", `${bytes.length - cursor} bytes after IEND`)
      }
      if (!sawHeader || !sawData) {
        throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "missing IHDR or IDAT")
      }
      return {
        width,
        height,
        exifOrientation: null,
        metadataFound,
        sanitized: concat(kept),
        alreadyClean: metadataFound.length === 0,
      }
    }
  }
  throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "no IEND")
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const WEBP_STRIP = new Set(["EXIF", "XMP ", "ICCP"])
const WEBP_ANIMATION = new Set(["ANIM", "ANMF"])
const WEBP_VP8X_ICC = 0x20
const WEBP_VP8X_EXIF = 0x08
const WEBP_VP8X_XMP = 0x04

function inspectWebp(bytes: Uint8Array): Omit<MediaImageInspection, "mime" | "byteSize"> {
  if (bytes.length < 12) throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "short RIFF")
  const riffSize = le32(bytes, 4)
  if (riffSize + 8 !== bytes.length) {
    throw new MediaImageError(
      riffSize + 8 < bytes.length ? "MEDIA_TRAILING_BYTES" : "MEDIA_CONTENT_CORRUPT",
      `RIFF size ${riffSize} vs file ${bytes.length}`,
    )
  }
  const metadataFound: string[] = []
  const body: Uint8Array[] = []
  let width = 0
  let height = 0
  let vp8xFlagsAt = -1
  let sawImage = false
  let cursor = 12

  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "truncated chunk header")
    }
    const fourcc = ascii(bytes, cursor, 4)
    const size = le32(bytes, cursor + 4)
    const payloadAt = cursor + 8
    if (payloadAt + size > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", `chunk ${fourcc} overruns file`)
    }
    const padded = size + (size & 1)
    if (payloadAt + padded > bytes.length) {
      throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "missing RIFF pad byte")
    }
    const chunkEnd = payloadAt + padded

    if (WEBP_ANIMATION.has(fourcc)) {
      throw new MediaImageError("MEDIA_ANIMATION_UNSUPPORTED", fourcc)
    }
    if (fourcc === "VP8X") {
      if (size < 10) throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "short VP8X")
      width = le24(bytes, payloadAt + 4) + 1
      height = le24(bytes, payloadAt + 7) + 1
      // Remember where the flags byte will live in the rebuilt buffer.
      vp8xFlagsAt = body.reduce((sum, part) => sum + part.length, 0) + 8
    }
    if (fourcc === "VP8 ") {
      if (size < 10 || bytes[payloadAt + 3] !== 0x9d || bytes[payloadAt + 4] !== 0x01
        || bytes[payloadAt + 5] !== 0x2a) {
        throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "bad VP8 sync code")
      }
      if (!width || !height) {
        width = le16(bytes, payloadAt + 6) & 0x3fff
        height = le16(bytes, payloadAt + 8) & 0x3fff
      }
      sawImage = true
    }
    if (fourcc === "VP8L") {
      if (size < 5 || bytes[payloadAt] !== 0x2f) {
        throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "bad VP8L signature")
      }
      const packed = le32(bytes, payloadAt + 1)
      if (!width || !height) {
        width = (packed & 0x3fff) + 1
        height = ((packed >>> 14) & 0x3fff) + 1
      }
      sawImage = true
    }

    if (WEBP_STRIP.has(fourcc)) {
      metadataFound.push(`WEBP:${fourcc.trim()}`)
    } else {
      body.push(bytes.subarray(cursor, chunkEnd))
    }
    cursor = chunkEnd
  }
  if (!sawImage || width < 1 || height < 1) {
    throw new MediaImageError("MEDIA_CONTENT_CORRUPT", "no VP8/VP8L payload")
  }

  const payload = concat(body)
  if (vp8xFlagsAt >= 0 && vp8xFlagsAt < payload.length) {
    // The extended header advertises which metadata chunks exist. Once they are
    // gone the flags must follow, or a strict decoder sees a malformed file.
    payload[vp8xFlagsAt] &= ~(WEBP_VP8X_ICC | WEBP_VP8X_EXIF | WEBP_VP8X_XMP)
  }
  const header = new Uint8Array(12)
  header.set(bytes.subarray(0, 12))
  const size = payload.length + 4
  header[4] = size & 0xff
  header[5] = (size >>> 8) & 0xff
  header[6] = (size >>> 16) & 0xff
  header[7] = (size >>> 24) & 0xff

  return {
    width,
    height,
    exifOrientation: null,
    metadataFound,
    sanitized: concat([header, payload]),
    alreadyClean: metadataFound.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function inspectImage(
  bytes: Uint8Array,
  declaredMime: string,
  limits: MediaImageLimits = EXTERNAL_PROCESSOR_LIMITS,
): MediaImageInspection {
  if (!bytes || bytes.length === 0) throw new MediaImageError("MEDIA_EMPTY")
  if (bytes.length > limits.maxFileBytes) throw new MediaImageError("MEDIA_TOO_LARGE")
  if (!(MEDIA_ALLOWED_MIME as readonly string[]).includes(declaredMime)) {
    throw new MediaImageError("MEDIA_MIME_UNSUPPORTED", declaredMime)
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 256))
  if (SVG_HINT.test(head)) throw new MediaImageError("MEDIA_MIME_MISMATCH", "markup detected")

  const sniffed = sniffImageMime(bytes)
  if (!sniffed) throw new MediaImageError("MEDIA_MIME_MISMATCH", "unrecognised container")
  if (sniffed !== declaredMime) {
    throw new MediaImageError("MEDIA_MIME_MISMATCH", `${sniffed} declared as ${declaredMime}`)
  }

  const inspected = sniffed === "image/jpeg"
    ? inspectJpeg(bytes)
    : sniffed === "image/png"
      ? inspectPng(bytes)
      : inspectWebp(bytes)

  if (
    inspected.width < 1 || inspected.height < 1
    || inspected.width > limits.maxEdge || inspected.height > limits.maxEdge
    || inspected.width * inspected.height > limits.maxPixels
  ) {
    throw new MediaImageError(
      "MEDIA_DIMENSIONS_INVALID", `${inspected.width}x${inspected.height}`,
    )
  }
  return {
    ...inspected,
    mime: sniffed,
    byteSize: bytes.length,
    alreadyClean: inspected.alreadyClean && sameBytes(inspected.sanitized, bytes),
  }
}

/**
 * Full acceptance check for an object the pipeline is about to keep.
 *
 * Bytes must arrive already normalised: no metadata, no EXIF orientation other
 * than the identity. Anything else is rejected instead of silently rewritten,
 * so the checksum and byte size recorded in the database always describe the
 * exact object stored in the bucket.
 */
export function verifyNormalizedImage(
  bytes: Uint8Array,
  declaredMime: string,
  limits: MediaImageLimits = EXTERNAL_PROCESSOR_LIMITS,
): MediaImageInspection {
  const inspection = inspectImage(bytes, declaredMime, limits)
  if (inspection.exifOrientation !== null && inspection.exifOrientation !== 1) {
    throw new MediaImageError(
      "MEDIA_ORIENTATION_NOT_NORMALIZED", `orientation ${inspection.exifOrientation}`,
    )
  }
  if (!inspection.alreadyClean) {
    throw new MediaImageError(
      "MEDIA_METADATA_PRESENT", inspection.metadataFound.join(",") || "byte drift",
    )
  }
  return inspection
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
