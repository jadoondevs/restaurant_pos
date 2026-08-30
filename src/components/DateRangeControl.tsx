/**
 * Shared historical date-filter controls (follow-up batch after Batch 11).
 *
 * A single canonical value shape — { from, to } as "YYYY-MM-DD" strings —
 * feeds every backend report/list query directly through
 * electron/utils/dateRange.ts's resolveDateRange(), which already expands a
 * bare date-only string to the full inclusive local day. A "single date"
 * selection is therefore represented simply as from === to; there is no
 * separate wire format to keep in sync, so Dashboard/Orders/Reports all
 * share the exact same date semantics the backend already implements.
 */

export interface DateFilterValue {
  from: string; // "YYYY-MM-DD"
  to: string; // "YYYY-MM-DD"
}

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800';
const toggleWrapClass =
  'inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900';
const toggleBtnClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    active
      ? 'bg-brand-600 text-white'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

/**
 * The single/range toggle plus the matching date input(s) — no "Today"
 * shortcut. Used standalone by Reports.tsx's existing "Custom Range" period
 * (which already has its own Daily/Weekly/Monthly presets alongside it), and
 * internally by DateFilterBar below.
 */
export function SingleOrRangeInputs({
  value,
  onChange,
}: {
  value: DateFilterValue;
  onChange: (v: DateFilterValue) => void;
}) {
  const isSingle = value.from === value.to;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={toggleWrapClass}>
        <button
          type="button"
          onClick={() => {
            if (!isSingle) onChange({ from: value.from, to: value.from });
          }}
          className={toggleBtnClass(isSingle)}
        >
          Single Date
        </button>
        <button
          type="button"
          onClick={() => {
            // Entering range mode keeps the current date as `from` and lets
            // the user pick a distinct `to` — nudging `to` one day later so
            // the range control doesn't visually start collapsed.
            if (isSingle) {
              const next = new Date(value.from);
              next.setDate(next.getDate() + 1);
              const to = next.toISOString().slice(0, 10);
              onChange({ from: value.from, to: to > todayIso() ? todayIso() : to });
            }
          }}
          className={toggleBtnClass(!isSingle)}
        >
          Date Range
        </button>
      </div>

      {isSingle ? (
        <input
          type="date"
          value={value.from}
          max={todayIso()}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to: e.target.value })}
          className={inputClass}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to })}
            className={inputClass}
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={todayIso()}
            onChange={(e) => e.target.value && onChange({ from: value.from, to: e.target.value })}
            className={inputClass}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Today | Single Date | Date Range — the full control used by Dashboard
 * and Orders, per the approved spec's exact wording.
 */
export function DateFilterBar({
  value,
  onChange,
  className,
}: {
  value: DateFilterValue;
  onChange: (v: DateFilterValue) => void;
  className?: string;
}) {
  const isSingle = value.from === value.to;
  const isToday = isSingle && value.from === todayIso();

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}>
      <div className={toggleWrapClass}>
        <button
          type="button"
          onClick={() => onChange({ from: todayIso(), to: todayIso() })}
          className={toggleBtnClass(isToday)}
        >
          Today
        </button>
      </div>
      <SingleOrRangeInputs value={value} onChange={onChange} />
    </div>
  );
}

/** Human-readable label for the current selection, e.g. "Aug 25, 2026" or "Aug 20 – Aug 30, 2026". */
export function describeDateFilter(value: DateFilterValue, formatDate: (d: string) => string): string {
  if (value.from === value.to) return formatDate(value.from);
  return `${formatDate(value.from)} – ${formatDate(value.to)}`;
}
