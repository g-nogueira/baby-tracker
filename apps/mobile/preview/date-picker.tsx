export default function DatePicker(props: {
  mode: 'date' | 'time';
  value: Date;
  onChange?: (event: { type: string }, date: Date) => void;
}) {
  return (
    <input
      aria-label={`Choose ${props.mode}`}
      type={props.mode === 'date' ? 'date' : 'time'}
      defaultValue={
        props.mode === 'date'
          ? props.value.toISOString().slice(0, 10)
          : props.value.toTimeString().slice(0, 5)
      }
      onChange={(event) => {
        const date = new Date(props.value);
        if (props.mode === 'date') {
          const [y, m, d] = event.target.value.split('-').map(Number);
          date.setFullYear(y, m - 1, d);
        } else {
          const [h, m] = event.target.value.split(':').map(Number);
          date.setHours(h, m);
        }
        props.onChange?.({ type: 'set' }, date);
      }}
    />
  );
}
