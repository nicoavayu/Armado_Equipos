import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import StoryLikeCarousel from '../components/StoryLikeCarousel';

const StableAwardSlide = ({ label }) => {
  const [mountedLabel] = useState(label);
  return <div>{`${label}:${mountedLabel}`}</div>;
};

describe('StoryLikeCarousel', () => {
  test('remounts visible award content atomically when the active slide changes', () => {
    const { container } = render(
      <StoryLikeCarousel
        autoAdvance={false}
        slides={[
          { key: 'mvp', content: <StableAwardSlide label="MVP" /> },
          { key: 'glove', content: <StableAwardSlide label="MEJOR ARQUERO" /> },
        ]}
      />,
    );

    expect(screen.getByText('MVP:MVP')).toBeInTheDocument();

    const tapAreas = container.querySelectorAll('.z-40 > div');
    fireEvent.click(tapAreas[1]);

    expect(screen.getByText('MEJOR ARQUERO:MEJOR ARQUERO')).toBeInTheDocument();
    expect(screen.queryByText('MEJOR ARQUERO:MVP')).not.toBeInTheDocument();
  });

  test('holdLastSlide keeps the last slide open instead of closing the story by itself', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(
      <StoryLikeCarousel
        holdLastSlide
        onClose={onClose}
        slides={[
          { key: 'mvp', duration: 1000, content: <div>MVP</div> },
          { key: 'summary', duration: 1000, content: <div>RESUMEN</div> },
        ]}
      />,
    );
    act(() => { jest.advanceTimersByTime(1200); });
    expect(screen.getByText('RESUMEN')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(5000); });
    expect(screen.getByText('RESUMEN')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });
});
