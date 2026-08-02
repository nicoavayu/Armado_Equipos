import {
  MEDIA_LIMITS,
  MEDIA_VARIANT_BOX,
  describeMediaPipelineError,
  formatMediaBytes,
  localDisplayName,
  resolveUploadCapability,
  syntheticUploadName,
  variantGeometry,
  variantPlan,
} from '../features/torneos/domain/mediaPipeline';
import {
  targetMimeFor,
  validateSelection,
} from '../features/torneos/domain/mediaImageClient';

/**
 * Independent reimplementation of the geometry rule. If this and the shipped
 * one ever disagree, one of them is wrong — and the processor, which computes
 * the same thing a third time in TypeScript and a fourth in SQL, will reject
 * the upload rather than store a mismatched variant.
 */
function reference(kind, width, height) {
  const box = MEDIA_VARIANT_BOX[kind];
  const longest = Math.max(width, height);
  if (longest <= box) return { width, height };
  const scale = box / longest;
  return {
    width: Math.max(1, Math.floor(width * scale + 0.5)),
    height: Math.max(1, Math.floor(height * scale + 0.5)),
  };
}

describe('multimedia variant geometry', () => {
  test('matches the reference rule across shapes and orientations', () => {
    const cases = [
      [4000, 3000], [3000, 4000], [1, 1], [320, 320], [321, 240],
      [12000, 3000], [1600, 1600], [1601, 900], [7, 4001], [2, 3],
    ];
    for (const [width, height] of cases) {
      for (const kind of Object.keys(MEDIA_VARIANT_BOX)) {
        const derived = variantGeometry(kind, width, height);
        const expected = reference(kind, width, height);
        expect({ w: derived.width, h: derived.height })
          .toEqual({ w: expected.width, h: expected.height });
      }
    }
  });

  test('never upscales and never returns a zero edge', () => {
    for (const kind of Object.keys(MEDIA_VARIANT_BOX)) {
      const small = variantGeometry(kind, 40, 20);
      expect(small).toEqual({ kind, width: 40, height: 20 });
      const extreme = variantGeometry(kind, 12000, 1);
      expect(extreme.width).toBeLessThanOrEqual(MEDIA_VARIANT_BOX[kind]);
      expect(extreme.height).toBeGreaterThanOrEqual(1);
    }
  });

  test('is deterministic for the same input', () => {
    expect(variantGeometry('grid', 4001, 2999))
      .toEqual(variantGeometry('grid', 4001, 2999));
  });

  test('plans exactly the three derived variants, in contract order', () => {
    const plan = variantPlan(4000, 3000);
    expect(plan.map((entry) => entry.kind)).toEqual(['thumbnail', 'grid', 'detail']);
    expect(plan).toEqual([
      { kind: 'thumbnail', width: 320, height: 240 },
      { kind: 'grid', width: 800, height: 600 },
      { kind: 'detail', width: 1600, height: 1200 },
    ]);
  });

  test('rejects a kind outside the taxonomy instead of inventing a box', () => {
    expect(variantGeometry('hero', 4000, 3000)).toBeNull();
    expect(variantGeometry('original', 4000, 3000)).toBeNull();
  });
});

describe('upload capability', () => {
  const capable = { uploadReady: true, blockers: [], maxFileBytes: 12582912 };

  test('is closed when the backend says so, whatever the role', () => {
    const closed = resolveUploadCapability(
      { uploadReady: false, blockers: ['storage.bucket_absent'] },
      { canUpload: true },
    );
    expect(closed.canOfferUpload).toBe(false);
    expect(closed.blockers).toEqual(['storage.bucket_absent']);
  });

  test('stays closed while any single processing tier is missing', () => {
    // El backend puede tener storage, signer y processor listos y aun así
    // faltarle el decode de píxeles, el transcode, el saneo de metadata, el
    // antivirus o la limpieza. Ninguno de esos casos ofrece carga.
    const tiers = [
      'processor.pixel_decode_absent',
      'processor.pixel_transcode_absent',
      'processor.metadata_sanitization_absent',
      'processor.antivirus_absent',
      'cleanup.unavailable',
    ];
    for (const blocker of tiers) {
      const partial = resolveUploadCapability(
        {
          uploadReady: false,
          storageReady: true,
          signerReady: true,
          processorReady: true,
          blockers: [blocker],
        },
        { canUpload: true },
      );
      expect(partial.canOfferUpload).toBe(false);
      expect(partial.uploadReady).toBe(false);
      expect(partial.blockers).toEqual([blocker]);
    }
  });

  test('reports the pixel and antivirus tiers from the backend, never assumed', () => {
    const derived = resolveUploadCapability(
      { uploadReady: true, blockers: [], pixelTranscode: true, antivirusScanning: true },
      { canUpload: true },
    );
    expect(derived.pixelTranscode).toBe(true);
    expect(derived.antivirusScanning).toBe(true);
    // Y ausentes significa false, nunca "probablemente sí".
    const absent = resolveUploadCapability(capable, { canUpload: true });
    expect(absent.pixelTranscode).toBe(false);
    expect(absent.antivirusScanning).toBe(false);
  });

  test('is closed when the role cannot upload, whatever the backend says', () => {
    expect(resolveUploadCapability(capable, { canUpload: false }).canOfferUpload)
      .toBe(false);
  });

  test('is closed when the backend said nothing at all', () => {
    expect(resolveUploadCapability(undefined, { canUpload: true }).canOfferUpload)
      .toBe(false);
    expect(resolveUploadCapability(null, { canUpload: true }).canOfferUpload)
      .toBe(false);
    expect(resolveUploadCapability({}, { canUpload: true }).canOfferUpload)
      .toBe(false);
  });

  test('never treats a truthy non-boolean as ready', () => {
    for (const value of ['true', 1, 'yes', {}]) {
      expect(resolveUploadCapability({ uploadReady: value }, { canUpload: true })
        .canOfferUpload).toBe(false);
    }
  });

  test('opens only when both sides agree', () => {
    const open = resolveUploadCapability(capable, { canUpload: true });
    expect(open.canOfferUpload).toBe(true);
    expect(open.maxFileBytes).toBe(12582912);
  });

  test('does not claim transcoding or antivirus unless the backend does', () => {
    const plain = resolveUploadCapability(capable, { canUpload: true });
    expect(plain.pixelTranscode).toBe(false);
    expect(plain.antivirusScanning).toBe(false);
  });

  test('never names storage, the bucket or the environment in product copy', () => {
    const copy = [
      resolveUploadCapability(null, { canUpload: true }).unavailableCopy,
      resolveUploadCapability(null, { canUpload: false }).unavailableCopy,
    ].join(' ');
    expect(copy).not.toMatch(/storage|bucket|signer|processor|staging|supabase/i);
  });
});

describe('local file handling', () => {
  const file = (name, type, size = 1024) => {
    const value = new File(['x'], name, { type });
    Object.defineProperty(value, 'size', { value: size });
    return value;
  };

  test('maps only the formats the pipeline can store', () => {
    expect(targetMimeFor(file('a.jpg', 'image/jpeg'))).toBe('image/jpeg');
    expect(targetMimeFor(file('a.png', 'image/png'))).toBe('image/png');
    expect(targetMimeFor(file('a.webp', 'image/webp'))).toBe('image/webp');
    expect(targetMimeFor(file('a.svg', 'image/svg+xml'))).toBeNull();
    expect(targetMimeFor(file('a.gif', 'image/gif'))).toBeNull();
    expect(targetMimeFor(file('a.mp4', 'video/mp4'))).toBeNull();
  });

  test('re-encodes HEIC to JPEG rather than storing it as-is', () => {
    expect(targetMimeFor(file('a.heic', 'image/heic'))).toBe('image/jpeg');
    expect(targetMimeFor(file('a.heif', 'image/heif'))).toBe('image/jpeg');
  });

  test('rejects unsupported formats, empty files and absurd sizes', () => {
    expect(validateSelection(null).valid).toBe(false);
    expect(validateSelection(file('a.svg', 'image/svg+xml')).code).toBe('mime');
    expect(validateSelection(file('a.jpg', 'image/jpeg', 0)).code).toBe('size');
    expect(validateSelection(file('a.jpg', 'image/jpeg', MEDIA_LIMITS.maxFileBytes * 5)).code)
      .toBe('size');
  });

  test('accepts a large file that re-encoding can plausibly shrink', () => {
    expect(validateSelection(file('a.jpg', 'image/jpeg', MEDIA_LIMITS.maxFileBytes * 2)).valid)
      .toBe(true);
  });

  test('the name sent to the server carries nothing from the filesystem', () => {
    expect(syntheticUploadName('image/jpeg')).toBe('upload.jpg');
    expect(syntheticUploadName('image/png')).toBe('upload.png');
    expect(syntheticUploadName('image/webp')).toBe('upload.webp');
    expect(syntheticUploadName('image/gif')).toBe('upload.jpg');
  });

  test('the local display name is sanitised and bounded', () => {
    expect(localDisplayName({ name: 'Final - Nicolás.jpg' }, 0)).toBe('Final - Nicolás');
    expect(localDisplayName({ name: '../../etc/passwd.jpg' }, 0)).toBe('....etcpasswd');
    expect(localDisplayName({ name: '<script>x</script>.png' }, 0)).toBe('scriptxscript');
    expect(localDisplayName({ name: '.jpg' }, 4)).toBe('Foto 05');
    expect(localDisplayName({ name: `${'a'.repeat(200)}.jpg` }, 0)).toHaveLength(48);
  });

  test('formats sizes without pretending to know an unknown one', () => {
    expect(formatMediaBytes(undefined)).toBe('—');
    expect(formatMediaBytes(900)).toBe('900 B');
    expect(formatMediaBytes(2048)).toBe('2 KB');
    expect(formatMediaBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('pipeline error copy', () => {
  test('translates content rejections into something actionable', () => {
    expect(describeMediaPipelineError('source_rejected', 'MEDIA_MIME_MISMATCH'))
      .toMatch(/no es una foto/i);
    expect(describeMediaPipelineError('source_rejected', 'MEDIA_ANIMATION_UNSUPPORTED'))
      .toMatch(/animadas/i);
    expect(describeMediaPipelineError('duplicate_asset')).toMatch(/ya está en el archivo/i);
  });

  test('falls back without leaking an unknown code to the user', () => {
    const message = describeMediaPipelineError('some_internal_thing', 'PG_42501');
    expect(message).not.toMatch(/some_internal_thing|PG_42501/);
    expect(message).toMatch(/Reintentá/);
  });

  test('never surfaces infrastructure vocabulary', () => {
    const codes = [
      'auth_required', 'forbidden', 'upload_session_invalid', 'quota_exceeded',
      'storage_unavailable', 'processing_required', 'variant_rejected',
    ];
    for (const code of codes) {
      expect(describeMediaPipelineError(code))
        .not.toMatch(/bucket|signer|processor|supabase|policy|rls/i);
    }
  });
});
