interface PreferenceToggleProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

export function PreferenceToggle({ label, checked, onToggle }: PreferenceToggleProps) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer text-sm text-title">
      <span>{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors
          ${checked ? 'bg-primary' : 'bg-container2 border border-container2-border'}`}
      >
        <span
          className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
    </label>
  );
}
