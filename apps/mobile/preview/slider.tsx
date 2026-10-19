export default function Slider(props: {
  accessibilityLabel?: string;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  value?: number;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  thumbTintColor?: string;
}) {
  return (
    <input
      aria-label={props.accessibilityLabel}
      type="range"
      min={props.minimumValue}
      max={props.maximumValue}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onValueChange?.(Number(event.target.value))}
      style={{ width: '100%', minHeight: 44, accentColor: props.thumbTintColor }}
    />
  );
}
