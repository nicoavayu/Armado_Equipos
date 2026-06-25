import { buildMyMatchSections } from '../utils/myMatchesSections';

const buildSections = (partidos) => buildMyMatchSections(partidos, {
  isMatchFinished: (partido) => Boolean(partido.finished),
  isPostMatchCandidate: (partido) => Boolean(partido.finished && partido.legacy),
  isPostMatchVisible: (partido) => partido.visible !== false,
});

describe('Mis partidos sections', () => {
  test('puts upcoming matches first and post-match matches below their separator', () => {
    const sections = buildSections([
      { id: 'post-older', legacy: true, finished: true, fecha: '2026-01-02', hora: '20:00' },
      { id: 'future-later', legacy: true, finished: false, fecha: '2026-01-20', hora: '19:00' },
      { id: 'post-recent', legacy: true, finished: true, fecha: '2026-01-08', hora: '21:00' },
      { id: 'future-sooner', legacy: true, finished: false, fecha: '2026-01-10', hora: '18:00' },
    ]);

    expect(sections.map((section) => section.title)).toEqual(['Próximos partidos', 'Post partido']);
    expect(sections[0].partidos.map((partido) => partido.id)).toEqual(['future-sooner', 'future-later']);
    expect(sections[1].partidos.map((partido) => partido.id)).toEqual(['post-recent', 'post-older']);
  });

  test('does not create an empty post-match block when there are only upcoming matches', () => {
    const sections = buildSections([
      { id: 'future-a', legacy: true, finished: false, fecha: '2026-01-10', hora: '18:00' },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'upcoming', title: 'Próximos partidos' });
  });

  test('shows the post-match block when only post-match cards are visible', () => {
    const sections = buildSections([
      { id: 'post-a', legacy: true, finished: true, fecha: '2026-01-08', hora: '18:00' },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'post-match', title: 'Post partido' });
  });

  test('excludes finished matches that are not post-match candidates or are not visible', () => {
    const sections = buildSections([
      { id: 'challenge-finished', legacy: false, finished: true, fecha: '2026-01-08', hora: '18:00' },
      { id: 'post-hidden', legacy: true, finished: true, visible: false, fecha: '2026-01-09', hora: '18:00' },
      { id: 'future-a', legacy: true, finished: false, fecha: '2026-01-10', hora: '18:00' },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].partidos.map((partido) => partido.id)).toEqual(['future-a']);
  });
});
