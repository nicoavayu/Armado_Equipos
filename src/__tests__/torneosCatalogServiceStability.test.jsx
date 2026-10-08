// Explorar torneos in the hybrid composition loads each call ONCE. Create React App replaces `process.env` with a
// fresh object literal wherever it is read, so a hook that memoized on `env = process.env` built a new gateway
// service on every render; a page that keeps its own state (the call, the request form) then reloaded forever.
// Reproduced here with a `process.env` that is a new object on every read, exactly like the browser bundle, installed
// before the modules under test are loaded.
const HYBRID = {
  REACT_APP_SUPABASE_URL: 'https://core.example.test',
  REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test',
  REACT_APP_TORNEOS_CONNECTED_MODE: 'on',
};
const realEnv = process.env;
const browserLikeEnv = { ...realEnv, ...HYBRID };
Object.defineProperty(process, 'env', { configurable: true, get: () => ({ ...browserLikeEnv }) });

const mockPages = [];
jest.mock('../features/torneos/components/PublicTournamentPage', () => function PageProbe({ service, catalogService }) {
  mockPages.push([service, catalogService]);
  return null;
});

const React = require('react');
const { act, fireEvent, render, screen } = require('@testing-library/react');
const { useCatalogService } = require('../features/torneos/components/connected/useCatalogService');
const PublicTournamentRoute = require('../features/torneos/components/PublicTournamentRoute').default;

const FLAGS = Object.freeze({ torneosEnabled: true, publicPages: true });

afterAll(() => {
  Object.defineProperty(process, 'env', { configurable: true, writable: true, value: realEnv });
});

function Rerender({ children }) {
  const [renders, setRenders] = React.useState(0);
  return (
    <>
      <button type="button" onClick={() => setRenders(renders + 1)}>{`render ${renders}`}</button>
      {children(renders)}
    </>
  );
}

describe('catalog service identity across renders (hybrid)', () => {
  test('the bundle-like env really is a new object on every read', () => {
    expect(process.env).not.toBe(process.env);
    expect(process.env.REACT_APP_TORNEOS_CONNECTED_MODE).toBe('on');
  });

  test('useCatalogService returns the same gateway service on every render', () => {
    const seen = [];
    function Probe() {
      seen.push(useCatalogService({ flags: FLAGS }));
      return null;
    }
    render(<Rerender>{(renders) => <Probe renders={renders} />}</Rerender>);
    act(() => { fireEvent.click(screen.getByRole('button')); });
    act(() => { fireEvent.click(screen.getByRole('button')); });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0].mode).toBe('hybrid');
    expect(new Set(seen).size).toBe(1);
  });

  test('the public tournament route keeps its services across renders', () => {
    mockPages.length = 0;
    render(<Rerender>{(renders) => <PublicTournamentRoute flags={FLAGS} renders={renders} />}</Rerender>);
    act(() => { fireEvent.click(screen.getByRole('button')); });
    expect(mockPages.length).toBeGreaterThanOrEqual(2);
    expect(mockPages[0][0].mode).toBe('hybrid');
    expect(new Set(mockPages.map(([service]) => service)).size).toBe(1);
    expect(new Set(mockPages.map(([, catalog]) => catalog)).size).toBe(1);
  });
});
