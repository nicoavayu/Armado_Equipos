import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SwipeDismissibleActivityItem from '../components/SwipeDismissibleActivityItem';

const firePointerEvent = (target, type, { pointerId, pointerType = 'touch', clientX, clientY, timeStamp = 0 }) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(target, event);
};

const swipe = (target, { pointerId = 1, from = 220, to, fromY = 20, toY = 22 }) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId,
    clientX: from,
    clientY: fromY,
    timeStamp: 0,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId,
    clientX: to,
    clientY: toY,
    timeStamp: 40,
  });
  firePointerEvent(target, 'pointerup', {
    pointerId,
    clientX: to,
    clientY: toY,
    timeStamp: 80,
  });
};

const androidWebViewSwipe = (target) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId: 3,
    clientX: 220,
    clientY: 20,
    timeStamp: 0,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId: 3,
    clientX: 190,
    clientY: 20,
    timeStamp: 20,
  });
  firePointerEvent(target, 'lostpointercapture', {
    pointerId: 3,
    clientX: 170,
    clientY: 20,
    timeStamp: 30,
  });
  firePointerEvent(window, 'pointermove', {
    pointerId: 3,
    clientX: 120,
    clientY: 20,
    timeStamp: 50,
  });
  firePointerEvent(window, 'pointermove', {
    pointerId: 3,
    clientX: 40,
    clientY: 20,
    timeStamp: 70,
  });
  firePointerEvent(window, 'pointerup', {
    pointerId: 3,
    clientX: 40,
    clientY: 20,
    timeStamp: 90,
  });
};

const verticalDrag = (target) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId: 2,
    clientX: 220,
    clientY: 20,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId: 2,
    clientX: 224,
    clientY: 92,
  });
  firePointerEvent(target, 'pointerup', {
    pointerId: 2,
    clientX: 224,
    clientY: 92,
  });
};

const SingleItemHarness = ({ onNavigate = jest.fn(), onDismiss = jest.fn(), isDismissing = false }) => (
  <SwipeDismissibleActivityItem
    itemKey="activity-one"
    onDismiss={onDismiss}
    isDismissing={isDismissing}
  >
    <button type="button" onClick={onNavigate}>
      Nueva solicitud
    </button>
  </SwipeDismissibleActivityItem>
);

describe('SwipeDismissibleActivityItem', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not render a visible delete action', () => {
    render(<SingleItemHarness />);

    expect(screen.queryByText(/eliminar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument();
  });

  test('keeps normal tap behavior when there is no swipe', () => {
    const onNavigate = jest.fn();
    render(<SingleItemHarness onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /nueva solicitud/i }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test('short horizontal swipe returns and blocks accidental click', () => {
    jest.useFakeTimers();
    const onNavigate = jest.fn();
    const onDismiss = jest.fn();
    render(<SingleItemHarness onNavigate={onNavigate} onDismiss={onDismiss} />);

    const row = screen.getByRole('button', { name: /nueva solicitud/i });
    swipe(row, { to: 170 });
    fireEvent.click(row);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(row.parentElement).toHaveStyle('transform: translate3d(0px, 0, 0) rotate(0deg)');
  });

  test('half-width swipe returns instead of dismissing', () => {
    const onDismiss = jest.fn();
    render(<SingleItemHarness onDismiss={onDismiss} />);

    swipe(screen.getByRole('button', { name: /nueva solicitud/i }), {
      from: 240,
      to: 80,
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('sufficient left swipe dismisses directly', () => {
    const onDismiss = jest.fn();
    render(<SingleItemHarness onDismiss={onDismiss} />);

    swipe(screen.getByRole('button', { name: /nueva solicitud/i }), { to: 40 });

    expect(onDismiss).toHaveBeenCalledWith('activity-one');
  });

  test('sufficient right swipe dismisses directly', () => {
    const onDismiss = jest.fn();
    render(<SingleItemHarness onDismiss={onDismiss} />);

    swipe(screen.getByRole('button', { name: /nueva solicitud/i }), { from: 40, to: 220 });

    expect(onDismiss).toHaveBeenCalledWith('activity-one');
  });

  test('keeps tracking after Android WebView drops pointer capture', () => {
    const onDismiss = jest.fn();
    render(<SingleItemHarness onDismiss={onDismiss} />);

    androidWebViewSwipe(screen.getByRole('button', { name: /nueva solicitud/i }));

    expect(onDismiss).toHaveBeenCalledWith('activity-one');
  });

  test('does not treat vertical scrolling as a dismiss gesture', () => {
    const onDismiss = jest.fn();
    render(<SingleItemHarness onDismiss={onDismiss} />);

    verticalDrag(screen.getByRole('button', { name: /nueva solicitud/i }));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
