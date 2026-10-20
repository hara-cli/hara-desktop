import "./toggle-switch.css";

export function ToggleSwitch({ label, checked, disabled = false, onCheckedChange }: {
  label: string; checked: boolean; disabled?: boolean; onCheckedChange?: (checked: boolean) => void;
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
    className="wss-switch hara-switch" onClick={() => onCheckedChange?.(!checked)}>
    <span className="hara-switch-track" aria-hidden="true"><span className="hara-switch-thumb" /></span>
  </button>;
}
