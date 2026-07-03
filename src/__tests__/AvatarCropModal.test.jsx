import React from 'react';
import { render } from '@testing-library/react';
import AvatarCropModal, {
  MIN_ZOOM,
  clampOffset,
  computeCropSourceRect,
} from '../components/AvatarCropModal';

describe('AvatarCropModal crop maths', () => {
  const CIRCLE = 300;

  test('clampOffset keeps the image covering the circle', () => {
    // Landscape 1200x800 at cover scale for a 300px circle: base = 300/800.
    const scale = CIRCLE / 800;
    // Horizontal overhang: (1200*0.375 - 300)/2 = 75px each side.
    expect(clampOffset(0, 1200, scale, CIRCLE)).toBe(0);
    expect(clampOffset(60, 1200, scale, CIRCLE)).toBe(60);
    expect(clampOffset(500, 1200, scale, CIRCLE)).toBe(75);
    expect(clampOffset(-500, 1200, scale, CIRCLE)).toBe(-75);
    // The short axis has no slack at cover scale.
    expect(clampOffset(10, 800, scale, CIRCLE)).toBeCloseTo(0);
    expect(clampOffset(-10, 800, scale, CIRCLE)).toBeCloseTo(0);
  });

  test('centered at MIN_ZOOM the source rect is the centred cover square', () => {
    const { sx, sy, size } = computeCropSourceRect({
      naturalW: 1200,
      naturalH: 800,
      zoom: MIN_ZOOM,
      tx: 0,
      ty: 0,
      circle: CIRCLE,
    });
    // Cover fit of a 1200x800 image → the visible square is 800x800 centred.
    expect(size).toBeCloseTo(800);
    expect(sx).toBeCloseTo(200);
    expect(sy).toBeCloseTo(0);
  });

  test('zooming shrinks the source square around the centre', () => {
    const { sx, sy, size } = computeCropSourceRect({
      naturalW: 1000,
      naturalH: 1000,
      zoom: 2,
      tx: 0,
      ty: 0,
      circle: CIRCLE,
    });
    expect(size).toBeCloseTo(500);
    expect(sx).toBeCloseTo(250);
    expect(sy).toBeCloseTo(250);
  });

  test('panning right in display px moves the source window left in image px', () => {
    const base = CIRCLE / 800; // 0.375 display px per natural px
    const { sx, sy } = computeCropSourceRect({
      naturalW: 1200,
      naturalH: 800,
      zoom: MIN_ZOOM,
      tx: 75, // max allowed pan for this geometry
      ty: 0,
      circle: CIRCLE,
    });
    expect(sx).toBeCloseTo(200 - 75 / base); // 0 → left edge of the image
    expect(sx).toBeCloseTo(0);
    expect(sy).toBeCloseTo(0);
  });

  test('what the mask shows never leaves the image when offsets are clamped', () => {
    // Any clamped (tx, ty) must map to a source rect fully inside the image.
    const naturalW = 900;
    const naturalH = 1600;
    [1, 1.7, 3].forEach((zoom) => {
      const scale = (CIRCLE / Math.min(naturalW, naturalH)) * zoom;
      [-10000, -30, 0, 45, 10000].forEach((rawTx) => {
        [-10000, -12, 0, 60, 10000].forEach((rawTy) => {
          const tx = clampOffset(rawTx, naturalW, scale, CIRCLE);
          const ty = clampOffset(rawTy, naturalH, scale, CIRCLE);
          const { sx, sy, size } = computeCropSourceRect({ naturalW, naturalH, zoom, tx, ty, circle: CIRCLE });
          expect(sx).toBeGreaterThanOrEqual(-1e-6);
          expect(sy).toBeGreaterThanOrEqual(-1e-6);
          expect(sx + size).toBeLessThanOrEqual(naturalW + 1e-6);
          expect(sy + size).toBeLessThanOrEqual(naturalH + 1e-6);
        });
      });
    });
  });
});

describe('AvatarCropModal UI', () => {
  test('renders nothing while closed', () => {
    const { container } = render(
      <AvatarCropModal isOpen={false} imageUrl={null} onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('open modal offers Cancelar / Usar foto / Recentrar and a zoom slider', () => {
    const { getByText, getByLabelText } = render(
      <AvatarCropModal isOpen imageUrl="blob:fake" onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(getByText('Ajustar foto')).toBeTruthy();
    expect(getByText('Cancelar')).toBeTruthy();
    expect(getByText('Usar foto')).toBeTruthy();
    expect(getByText('Recentrar')).toBeTruthy();
    expect(getByLabelText('Zoom de la foto')).toBeTruthy();
    // Until the image loads, confirming is disabled (nothing to export yet).
    expect(getByText('Usar foto').closest('button').disabled).toBe(true);
  });
});
