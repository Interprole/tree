import type { ComponentChildren } from 'preact';

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onInput }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onInput: (v: number) => void }) {
  return (
    <label class="slider">
      <span class="lbl">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))} />
      <span class="val">
        {Number.isInteger(step) ? value : value.toFixed(1)}
        {unit}
      </span>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="track" aria-hidden="true">
        <span class="thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, small }: { value: T; options: { v: T; label: string; title?: string }[]; onChange: (v: T) => void; label?: string; small?: boolean }) {
  return (
    <div class="field">
      {label && <span class="lbl">{label}</span>}
      <div class={`seg ${small ? 'small' : ''}`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} role="radio" aria-checked={value === o.v} class={value === o.v ? 'on' : ''} title={o.title} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <label class="color-field">
      <input type="color" value={hex} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label class="field select">
      <span class="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}
