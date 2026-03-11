import React, { useMemo, useState } from 'react';

const toPrettyJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return '{}';
  }
};

const StatsDebugPanel = ({ enabled = false, entries = [] }) => {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return safeEntries.reduce((acc, entry) => {
      const outcome = String(entry?.result_application?.applied_outcome || 'excluded');
      const excludedReason = entry?.result_application?.excluded_reason || null;
      acc.total += 1;
      if (outcome === 'win') acc.win += 1;
      else if (outcome === 'draw') acc.draw += 1;
      else if (outcome === 'loss') acc.loss += 1;
      else if (outcome === 'pending') acc.pending += 1;
      else acc.excluded += 1;
      if (excludedReason) {
        acc.excludedByReason[excludedReason] = (acc.excludedByReason[excludedReason] || 0) + 1;
      }
      return acc;
    }, {
      total: 0,
      win: 0,
      draw: 0,
      loss: 0,
      pending: 0,
      excluded: 0,
      excludedByReason: {},
    });
  }, [entries]);

  if (!enabled) return null;

  return (
    <div className="mb-4 border border-amber-300/40 bg-amber-500/10">
      <button
        type="button"
        className="w-full text-left px-3 py-2 font-oswald text-sm text-amber-100 border-b border-amber-300/20 flex items-center justify-between"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>Stats Debug Panel (temporal)</span>
        <span>{open ? 'Ocultar' : 'Mostrar'}</span>
      </button>

      {open ? (
        <div className="p-3 space-y-3 font-mono text-xs text-amber-50/95">
          <div className="bg-black/25 border border-amber-300/20 p-2">
            <div>Total evaluados: {summary.total}</div>
            <div>Win: {summary.win} | Draw: {summary.draw} | Loss: {summary.loss}</div>
            <div>Pending: {summary.pending} | Excluded: {summary.excluded}</div>
            {Object.keys(summary.excludedByReason).length > 0 ? (
              <div className="mt-1">
                Excluded reasons: {toPrettyJson(summary.excludedByReason)}
              </div>
            ) : null}
          </div>

          {(Array.isArray(entries) ? entries : []).map((entry, index) => {
            const key = `${entry?.match_id || 'unknown'}-${index}`;
            const onCopy = async () => {
              try {
                await navigator.clipboard.writeText(toPrettyJson(entry));
              } catch (_error) {
                // Non-blocking in debug-only panel.
              }
            };
            return (
              <div key={key} className="bg-black/25 border border-amber-300/20 p-2 space-y-1">
                <div>matchId: {entry?.match_id ?? 'n/a'} | {entry?.nombre || 'Partido'}</div>
                <div>estado={entry?.estado ?? 'n/a'} survey_status={entry?.survey_status ?? 'n/a'} result_status={entry?.result_status ?? 'n/a'}</div>
                <div>winner_team={entry?.winner_team ?? 'null'} finished_at={entry?.finished_at ?? 'null'}</div>
                <div>source={entry?.team_selection?.selected_source ?? 'none'} reason={entry?.team_selection?.selected_reason ?? 'none'}</div>
                <div>resolvedTeam={entry?.user_resolution?.resolved_team ?? 'none'} foundInFinalRoster={String(Boolean(entry?.user_resolution?.found_in_final_roster))}</div>
                <div>counted_as_played={String(Boolean(entry?.result_application?.counted_as_played))} applied_outcome={entry?.result_application?.applied_outcome ?? 'excluded'} excluded_reason={entry?.result_application?.excluded_reason ?? 'none'}</div>
                <button
                  type="button"
                  className="px-2 py-1 border border-amber-300/30 bg-amber-300/10 text-amber-100"
                  onClick={onCopy}
                >
                  Copiar JSON
                </button>
                <pre className="whitespace-pre-wrap break-all bg-black/30 p-2 border border-amber-300/20">
                  {toPrettyJson(entry)}
                </pre>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default StatsDebugPanel;
