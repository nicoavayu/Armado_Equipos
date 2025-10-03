export function isFastResults() {
  const qs = new URLSearchParams(window.location.search);
  return qs.get('fastResults') === '1' || localStorage.getItem('SURVEY_RESULTS_TEST_FAST') === '1';
}