import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import PlayerPortraitDialog from '../features/torneos/components/PlayerPortraitDialog';
import { PLAYER_PORTRAIT_EDITOR_FRAME, clampCrop } from '../features/torneos/domain/playerPortraits';

// The signed URL is already there and the crop editor never corrects anything: the
// dialog alone must hold the crop that is shown, so a save on the very first frame
// cannot store an out-of-range value (the CI race of torneosPlayerPortraitUx).
jest.mock('../features/torneos/components/usePlayerPortraitUrl', () => ({
  usePlayerPortraitUrl: () => ({ status: 'ready', url: 'blob:portrait' }),
}));
jest.mock('../features/torneos/components/PlayerPortraitCropEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="crop-editor" />,
}));

const portrait = {
  ref: 'portrait-ref',
  width: 1200,
  height: 1800,
  crop: { x: 0.9, y: 0.1, zoom: 1 },
};

test('saving on the first frame stores the clamped crop, not the out-of-range saved one', () => {
  const onSave = jest.fn();
  render(<PlayerPortraitDialog playerName="Francisco González" portrait={portrait} onSave={onSave} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Guardar foto/ }));
  const shown = clampCrop(portrait.crop, { natural: { width: 1200, height: 1800 }, frameRatio: PLAYER_PORTRAIT_EDITOR_FRAME.ratio });
  expect(shown).not.toEqual(portrait.crop);
  expect(shown.x).toBe(0.5); // a vertical photo in a 4:5 frame has no horizontal play
  expect(onSave).toHaveBeenCalledWith({ file: null, crop: shown });
});

test('without dimensions the saved crop is kept as is until the image reports them', () => {
  const onSave = jest.fn();
  render(<PlayerPortraitDialog playerName="Francisco González" portrait={{ ...portrait, width: null, height: null }} onSave={onSave} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Guardar foto/ }));
  expect(onSave).toHaveBeenCalledWith({ file: null, crop: { x: 0.9, y: 0.1, zoom: 1 } });
});
