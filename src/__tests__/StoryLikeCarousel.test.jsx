import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
