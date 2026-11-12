import { type ComponentProps, type ReactNode, useId } from 'react';
import { Dialog as RDialog, Switch as RSwitch } from 'radix-ui';
import { X } from 'lucide-react';
import type { GraphNode } from '@vectora/graph-schema';
import { NODE_TYPE_LABELS } from '@vectora/graph-schema';
import { FAMILY_GLYPH, NODE_FAMILY } from '@/lib/tokens';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/** The brand wordmark. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-medium tracking-[0.32em] text-ink', className)} aria-label="VECTORA">
      VECTORA
    </span>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="dialog" style={wide ? { width: 'min(820px, calc(100vw - 32px))' } : undefined} aria-describedby={description ? undefined : undefined}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <RDialog.Title className="font-editorial text-[1.25rem]">{title}</RDialog.Title>
              {description ? <RDialog.Description className="label mt-1">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="btn btn-quiet btn-icon" aria-label="Close">
              <X size={16} strokeWidth={1.5} />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[0.9375rem]">{label}</span>
        {hint ? <span className="label block">{hint}</span> : null}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative mt-1 h-[20px] w-[36px] shrink-0 cursor-pointer rounded-[2px] border border-line bg-surface transition-colors duration-200 data-[state=checked]:border-indigo data-[state=checked]:bg-indigo"
      >
        <RSwitch.Thumb className="block h-[14px] w-[14px] translate-x-[2px] rounded-[1px] bg-ink-3 transition-transform duration-200 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-accent" />
      </RSwitch.Root>
    </div>
  );
}

export function SelectField<T extends string>({ label, hint, value, onChange, options }: { label: string; hint?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-2">
      <label htmlFor={id}>
        <span className="block text-[0.9375rem]">{label}</span>
        {hint ? <span className="label block max-w-[46ch]">{hint}</span> : null}
      </label>
      <select id={id} className="field w-auto min-w-[168px]" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NumberField({ label, hint, value, onChange, min, max, step = 1, unit }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-2">
      <label htmlFor={id}>
        <span className="block text-[0.9375rem]">{label}</span>
        {hint ? <span className="label block max-w-[46ch]">{hint}</span> : null}
      </label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          className="field w-[112px] font-mono text-[0.8125rem]"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        {unit ? <span className="meta">{unit}</span> : null}
      </span>
    </div>
  );
}

/** Type marker: a glyph plus the type name, so the type never depends on colour alone. */
export function TypeMark({ node, showLabel = true }: { node: Pick<GraphNode, 'type'>; showLabel?: boolean }) {
  return (
    <span className="meta inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true">{FAMILY_GLYPH[NODE_FAMILY[node.type]]}</span>
      {showLabel ? NODE_TYPE_LABELS[node.type] : <span className="sr-only">{NODE_TYPE_LABELS[node.type]}</span>}
    </span>
  );
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'error' | 'warning' | 'success'; children: ReactNode; action?: ReactNode }) {
  const color = tone === 'error' ? 'var(--error)' : tone === 'warning' ? 'var(--warning)' : tone === 'success' ? 'var(--success)' : 'var(--indigo)';
  const word = tone === 'error' ? 'Error' : tone === 'warning' ? 'Note' : tone === 'success' ? 'Done' : 'Info';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex items-start justify-between gap-4 border-l-2 bg-surface px-4 py-3 text-[0.875rem]" style={{ borderColor: color }}>
      <p>
        <span className="font-medium" style={{ color }}>
          {word}.
        </span>{' '}
        {children}
      </p>
      {action}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-[52ch] px-6 py-16">
      <h2 className="font-editorial text-[1.375rem]">{title}</h2>
      <div className="label mt-3 space-y-3 text-[0.9375rem]">{children}</div>
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="meta flex h-full min-h-[120px] items-center justify-center">
      {label}…
    </div>
  );
}

export function SectionHeading({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <h2 id={id} className="font-editorial text-[1.25rem]">
        {children}
      </h2>
      {aside ? <span className="meta">{aside}</span> : null}
    </div>
  );
}

export function IconButton({ label, children, className, ...rest }: { label: string; children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button type="button" {...rest} className={cx('btn btn-icon', className)} aria-label={label} title={label}>
      {children}
    </button>
  );
}
