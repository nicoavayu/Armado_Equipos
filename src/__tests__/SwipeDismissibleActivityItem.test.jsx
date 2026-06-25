import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SwipeDismissibleActivityItem from '../components/SwipeDismissibleActivityItem';

const DELETE_ACTION_NAME = /eliminar de actividad reciente/i;

const firePointerEvent = (target, type, { pointerId, pointerType = 'touch', clientX, clientY }) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
};

const swipeLeft = (target, pointerId = 1) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId,
    pointerType: 'touch',
    clientX: 220,
    clientY: 20,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId,
    pointerType: 'touch',
    clientX: 140,
    clientY: 22,
  });
  firePointerEvent(target, 'pointerup', {
    pointerId,
    pointerType: 'touch',
    clientX: 140,
    clientY: 22,
  });
};

const verticalDrag = (target) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 220,
    clientY: 20,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 224,
    clientY: 92,
  });
  firePointerEvent(target, 'pointerup', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 224,
    clientY: 92,
  });
};

const SingleItemHarness = ({ onNavigate = jest.fn(), onDismiss = jest.fn() }) => {
  const [openKey, setOpenKey] = useState(null);

  return (
    <SwipeDismissibleActivityItem
      itemKey="activity-one"
      isOpen={openKey === 'activity-one'}
      onRequestOpen={setOpenKey}
      onRequestClose={() => setOpenKey(null)}
      onDismiss={onDismiss}
    >
      <button type="button" onClick={onNavigate}>
        Nueva solicitud
      </button>
    </SwipeDismissibleActivityItem>
  );
};

const TwoItemHarness = () => {
  const [openKey, setOpenKey] = useState(null);

  return (
    <>
      {['activity-one', 'activity-two'].map((itemKey) => (
        <SwipeDismissibleActivityItem
          key={itemKey}
          itemKey={itemKey}
          isOpen={openKey === itemKey}
          onRequestOpen={setOpenKey}
          onRequestClose={() => setOpenKey(null)}
          onDismiss={jest.fn()}
        >
          <button type="button">{itemKey}</button>
        </SwipeDismissibleActivityItem>
      ))}
    </>
  );
};

describe('SwipeDismissibleActivityItem', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('reveals the delete action after a horizontal swipe from the item body', () => {
    render(<SingleItemHarness />);

    const row = screen.getByRole('button', { name: /nueva solicitud/i });
    expect(screen.queryByRole('button', { name: DELETE_ACTION_NAME })).not.toBeInTheDocument();

    swipeLeft(row);

    expect(screen.getByRole('button', { name: DELETE_ACTION_NAME })).toBeInTheDocument();
  });

  test('keeps normal tap behavior when the item is closed', () => {
    const onNavigate = jest.fn();
    render(<SingleItemHarness onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /nueva solicitud/i }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test('does not treat vertical scrolling as a swipe', () => {
    render(<SingleItemHarness />);

    verticalDrag(screen.getByRole('button', { name: /nueva solicitud/i }));

    expect(screen.queryByRole('button', { name: DELETE_ACTION_NAME })).not.toBeInTheDocument();
  });

  test('tapping opened content closes it instead of firing the child click', () => {
    jest.useFakeTimers();
    const onNavigate = jest.fn();
    render(<SingleItemHarness onNavigate={onNavigate} />);

    const row = screen.getByRole('button', { name: /nueva solicitud/i });
    swipeLeft(row);
    act(() => {
      jest.advanceTimersByTime(260);
    });
    fireEvent.click(row);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: DELETE_ACTION_NAME })).not.toBeInTheDocument();
  });

  test('allows only one item to remain open at a time', () => {
    render(<TwoItemHarness />);

    swipeLeft(screen.getByRole('button', { name: 'activity-one' }), 3);
    expect(screen.getAllByRole('button', { name: DELETE_ACTION_NAME })).toHaveLength(1);

    swipeLeft(screen.getByRole('button', { name: 'activity-two' }), 4);
    expect(screen.getAllByRole('button', { name: DELETE_ACTION_NAME })).toHaveLength(1);
  });
});
