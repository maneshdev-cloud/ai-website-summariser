/**
 * Staged progress indicator.
 *
 * The brief asks for "a loading indicator" — this app shows the actual
 * pipeline stages instead of one anonymous spinner, because the stages
 * are real: the client first calls /api/extract (fetch + Readability on
 * the server), then /api/summarise (chunking, map-reduce, generation).
 *
 * `current` is the index of the active stage; stages before it render as
 * done, stages after it as pending, and current === stages.length means
 * everything finished.
 */

export interface Stage {
  label: string;
  detail?: string;
}

interface Props {
  stages: Stage[];
  current: number;
  failed?: boolean;
}

function StageIcon({ state }: { state: 'done' | 'active' | 'pending' | 'failed' }) {
  if (state === 'done') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-6 w-6 items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <span className="h-6 w-6 rounded-full border-2 border-slate-200 bg-white" />;
}

export default function StageProgress({ stages, current, failed = false }: Props) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <ol className="space-y-3">
        {stages.map((stage, index) => {
          const state = failed && index === current
            ? 'failed'
            : index < current
              ? 'done'
              : index === current
                ? 'active'
                : 'pending';
          return (
            <li key={stage.label} className="flex items-center gap-3">
              <StageIcon state={state} />
              <div className="min-w-0">
                <p
                  className={
                    state === 'pending'
                      ? 'text-sm font-medium text-slate-400'
                      : 'text-sm font-medium text-slate-800'
                  }
                >
                  {stage.label}
                </p>
                {state === 'active' && stage.detail && (
                  <p className="truncate text-xs text-slate-500">{stage.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
