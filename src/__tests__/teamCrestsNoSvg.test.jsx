import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SVG_REJECTED_MESSAGE } from '../utils/imageUpload';

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: { storage: { from: (...args) => mockFrom(...args) } },
}));

jest.mock('../utils/notifyBlockingError', () => ({ notifyBlockingError: jest.fn() }));

jest.mock('../features/equipos/components/NeighborhoodAutocomplete', () => function MockAutocomplete() {
  return null;
});

// eslint-disable-next-line import/first
import { assertRasterTeamImage, uploadTeamCrest, uploadTeamMemberPhoto } from '../services/storage/teamCrests';
// eslint-disable-next-line import/first
import TeamFormModal from '../features/equipos/components/TeamFormModal';

const SVG_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const file = (content, name, type) => new File([content], name, { type });
const png = () => file(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'escudo.png', 'image/png');

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockGetPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://cdn.test/escudo.png' } });
  // CRA's jest config resets mock implementations between tests.
  mockFrom.mockReset().mockImplementation(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));
});

describe('team-crests storage guard (public bucket: raster only, never SVG)', () => {
  test('assertRasterTeamImage rejects SVG by MIME or extension with the Spanish message', () => {
    [
      file(SVG_MARKUP, 'escudo.svg', 'image/svg+xml'),
      file(SVG_MARKUP, 'escudo.svg', ''),
      file(SVG_MARKUP, 'escudo', 'image/svg+xml'),
    ].forEach((candidate) => {
      expect(() => assertRasterTeamImage(candidate)).toThrow(SVG_REJECTED_MESSAGE);
    });
  });

  test('assertRasterTeamImage rejects non-raster types and returns the raster MIME', () => {
    expect(() => assertRasterTeamImage(file('x', 'a.gif', 'image/gif'))).toThrow(/JPG, PNG o WEBP/);
    expect(() => assertRasterTeamImage(file('x', 'a.html', 'text/html'))).toThrow(/JPG, PNG o WEBP/);
    expect(() => assertRasterTeamImage(file('x', 'a.bin', ''))).toThrow(/JPG, PNG o WEBP/);
    expect(assertRasterTeamImage(png())).toBe('image/png');
    expect(assertRasterTeamImage(file('x', 'a.jpg', 'image/jpeg'))).toBe('image/jpeg');
    expect(assertRasterTeamImage(file('x', 'a.webp', 'image/webp'))).toBe('image/webp');
  });

  test('uploadTeamCrest never sends an SVG to storage', async () => {
    await expect(uploadTeamCrest({
      file: file(SVG_MARKUP, 'escudo.svg', 'image/svg+xml'),
      userId: 'u1',
      teamId: 't1',
    })).rejects.toThrow(SVG_REJECTED_MESSAGE);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('uploadTeamMemberPhoto never sends an SVG to storage', async () => {
    await expect(uploadTeamMemberPhoto({
      file: file(SVG_MARKUP, 'jugador.svg', 'image/svg+xml'),
      userId: 'u1',
      teamId: 't1',
      memberId: 'm1',
    })).rejects.toThrow(SVG_REJECTED_MESSAGE);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('raster crest and member photo upload with an explicit raster contentType', async () => {
    await expect(uploadTeamCrest({ file: png(), userId: 'u1', teamId: 't1' }))
      .resolves.toBe('https://cdn.test/escudo.png');
    await expect(uploadTeamMemberPhoto({ file: png(), userId: 'u1', teamId: 't1', memberId: 'm1' }))
      .resolves.toBe('https://cdn.test/escudo.png');
    expect(mockFrom).toHaveBeenCalledWith('team-crests');
    expect(mockUpload).toHaveBeenCalledTimes(2);
    mockUpload.mock.calls.forEach(([objectPath, body, options]) => {
      expect(objectPath).toMatch(/^u1\/t1\//);
      expect(objectPath).not.toMatch(/\.svg$/i);
      expect(body).toBeInstanceOf(File);
      expect(options.contentType).toBe('image/png');
    });
  });
});

describe('crest / member photo pickers', () => {
  test('TeamFormModal crest input does not offer SVG and rejects a picked SVG', async () => {
    render(<TeamFormModal isOpen initialTeam={null} onClose={jest.fn()} onSubmit={jest.fn()} />);
    // The modal renders through a portal into document.body.
    const input = document.body.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).not.toMatch(/svg/i);
    expect(input.getAttribute('accept')).toMatch(/image\/png/);

    fireEvent.change(input, { target: { files: [file(SVG_MARKUP, 'escudo.svg', 'image/svg+xml')] } });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(SVG_REJECTED_MESSAGE));
    expect(document.body.querySelector('img[src^="blob:"]')).toBeNull();
  });

  test('no Core crest/member-photo picker source lists SVG', () => {
    const root = path.join(__dirname, '..');
    [
      'features/equipos/components/TeamFormModal.jsx',
      'features/equipos/views/EquipoDetalleView.jsx',
    ].forEach((relative) => {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(source).not.toMatch(/image\/svg\+xml/);
      expect(source).toMatch(/accept=\{IMAGE_UPLOAD_ACCEPT\}/);
      expect(source).not.toMatch(/HEIC o SVG/);
    });
  });
});
