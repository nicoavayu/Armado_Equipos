import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DistanceSlider from '../components/jugar/DistanceSlider';

// jsdom can't deliver real PointerEvents; mirror the helper used by the swipe
// tests so we drive the slider's pointer handlers directly.
const firePointerEvent = (target, type, { pointerId = 1, clientX = 0, clientY = 0 } = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(target, event);
};

const mockTrackRect = (slider, { left = 0, width = 100 } = {}) => {
  jest.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    left, width, right: left + width, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON: () => {},
  });
};

const setup = (props = {}) => {
  const onChange = jest.fn();
  render(
    <DistanceSlider
      min={1}
      max={30}
      step={1}
      value={10}
      onChange={onChange}
      ariaLabel="Distancia"
      valueText="10 km"
      {...props}
    />,
  );
  return { onChange, slider: screen.getByRole('slider') };
};

describe('DistanceSlider', () => {
  test('expone la semántica ARIA de un slider accesible', () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute('aria-label', 'Distancia');
    expect(slider).toHaveAttribute('aria-valuemin', '1');
    expect(slider).toHaveAttribute('aria-valuemax', '30');
    expect(slider).toHaveAttribute('aria-valuenow', '10');
    expect(slider).toHaveAttribute('aria-valuetext', '10 km');
    expect(slider).toHaveAttribute('tabindex', '0');
  });

  test('el teclado mueve el valor y respeta los límites', () => {
    const { slider, onChange } = setup({ value: 10 });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(9);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith(15);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(30);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  test('un toque en la pista salta a esa posición (tap-to-position)', () => {
    const { slider, onChange } = setup({ value: 1 });
    mockTrackRect(slider, { left: 0, width: 100 });
    // 50% across a [1..30] range → round(1 + 0.5 * 29) = 16.
    firePointerEvent(slider, 'pointerdown', { clientX: 50 });
    expect(onChange).toHaveBeenCalledWith(16);
  });

  test('arrastrar con el puntero capturado sigue al dedo', () => {
    const { slider, onChange } = setup({ value: 1 });
    mockTrackRect(slider, { left: 0, width: 100 });
    // Emulate pointer capture so move events are honored.
    slider.setPointerCapture = jest.fn();
    slider.hasPointerCapture = jest.fn(() => true);

    firePointerEvent(slider, 'pointerdown', { clientX: 0 });
    firePointerEvent(slider, 'pointermove', { clientX: 100 });
    expect(onChange).toHaveBeenLastCalledWith(30); // dragged to the far end
  });

  test('en estado disabled ignora teclado y no es focuseable', () => {
    const { slider, onChange } = setup({ disabled: true });
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(slider).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    mockTrackRect(slider, { left: 0, width: 100 });
    firePointerEvent(slider, 'pointerdown', { clientX: 50 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
