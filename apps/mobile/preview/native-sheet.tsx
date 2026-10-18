import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
type DetentEvent = { nativeEvent: { index: number } };
interface Props {
  children?: ReactNode;
  initialDetentIndex?: number;
  detents?: (number | string)[];
  onDidPresent?: (event: DetentEvent) => void;
  onDidDismiss?: () => void;
  onDetentChange?: (event: DetentEvent) => void;
  accessibilityOptions?: { paneTitle?: string };
  backgroundColor?: string;
  grabberOptions?: { color?: string };
}
/** Browser-only boundary stand-in. Native gestures remain a phone acceptance check. */
export const TrueSheet = forwardRef(function Sheet(props: Props, ref) {
  const [index, setIndex] = useState(props.initialDetentIndex ?? 0);
  const initial = useRef(props).current;
  useEffect(() => {
    initial.onDidPresent?.({ nativeEvent: { index: initial.initialDetentIndex ?? 0 } });
  }, [initial]);
  useImperativeHandle(ref, () => ({
    resize: async (next: number) => {
      setIndex(next);
      props.onDetentChange?.({ nativeEvent: { index: next } });
    },
    dismiss: async () => props.onDidDismiss?.(),
  }));
  const height = props.detents?.[index];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.accessibilityOptions?.paneTitle}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#0006' }}
    >
      <button
        type="button"
        aria-label="Dismiss drawer"
        onClick={() => props.onDidDismiss?.()}
        style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent' }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 480,
          height: typeof height === 'number' ? `${height * 100}dvh` : 'auto',
          maxHeight: '94dvh',
          display: 'flex',
          flexDirection: 'column',
          background: props.backgroundColor,
          borderRadius: '28px 28px 0 0',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          aria-label="Expand or collapse drawer"
          onClick={() => {
            const next = index ? 0 : 1;
            setIndex(next);
            props.onDetentChange?.({ nativeEvent: { index: next } });
          }}
          style={{ height: 24, minHeight: 24, border: 0, background: 'transparent', padding: 10 }}
        >
          <span
            style={{
              display: 'block',
              height: 4,
              width: 42,
              margin: '0 auto',
              borderRadius: 8,
              background: props.grabberOptions?.color,
            }}
          />
        </button>
        {props.children}
      </div>
    </div>
  );
});
