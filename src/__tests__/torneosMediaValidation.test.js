import {
  formatMediaBytes,
  getMediaAssetUrl,
  MEDIA_LIMITS,
  prepareTournamentMediaBatch,
  validateTournamentMediaFile,
} from '../features/torneos/domain/mediaValidation';

function file(name, type, size = 1024) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('tournament media local validation', () => {
  test.each([
    ['foto.jpg', 'image/jpeg'],
    ['foto.jpeg', 'image/jpeg'],
    ['foto.png', 'image/png'],
    ['foto.webp', 'image/webp'],
  ])('accepts %s as %s', (name, type) => {
    expect(validateTournamentMediaFile(file(name, type))).toEqual({
      valid: true,
      code: null,
      message: '',
    });
  });

  test.each([
    ['vector.svg', 'image/svg+xml'],
    ['documento.pdf', 'application/pdf'],
    ['animada.gif', 'image/gif'],
    ['video.mp4', 'video/mp4'],
    ['pagina.html', 'text/html'],
  ])('rejects unsafe %s', (name, type) => {
    expect(validateTournamentMediaFile(file(name, type)).valid).toBe(false);
  });

  test('rejects extension and MIME mismatches', () => {
    expect(validateTournamentMediaFile(file('foto.png', 'image/jpeg')))
      .toEqual(expect.objectContaining({ valid: false, code: 'extension' }));
  });

  test('rejects empty and oversized files', () => {
    expect(validateTournamentMediaFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).code)
      .toBe('size');
    expect(validateTournamentMediaFile({
      name: 'a.jpg',
      type: 'image/jpeg',
      size: MEDIA_LIMITS.maxFileBytes + 1,
    }).code).toBe('size');
  });

  test('keeps valid files when one item in a batch is invalid', () => {
    const batch = prepareTournamentMediaBatch([
      file('uno.jpg', 'image/jpeg'),
      file('malo.svg', 'image/svg+xml'),
      file('tres.webp', 'image/webp'),
    ]);
    expect(batch.map((item) => item.status)).toEqual(['ready', 'invalid', 'ready']);
    expect(batch.map((item) => item.safeName)).toEqual(['Foto 01', 'Foto 02', 'Foto 03']);
  });

  test('bounds a manipulated batch without reading past the configured maximum', () => {
    const files = Array.from({ length: 100 }, (_, index) => (
      file(`foto-${index}.jpg`, 'image/jpeg')
    ));
    expect(prepareTournamentMediaBatch(files)).toHaveLength(40);
  });

  test('formats bytes and selects only delivery-safe variant URLs', () => {
    expect(formatMediaBytes(2048)).toBe('2 KB');
    expect(formatMediaBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(getMediaAssetUrl({
      thumbnailUrl: 'thumb',
      gridUrl: 'grid',
      detailUrl: 'detail',
      originalUrl: 'original',
    })).toBe('grid');
    expect(getMediaAssetUrl({
      thumbnailUrl: 'thumb',
      gridUrl: 'grid',
      detailUrl: 'detail',
      originalUrl: 'original',
    }, 'detail')).toBe('detail');
  });
});
