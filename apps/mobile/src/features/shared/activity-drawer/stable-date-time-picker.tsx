import DateTimePicker from '@react-native-community/datetimepicker';
import { type ComponentProps, useCallback, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

type Props = ComponentProps<typeof DateTimePicker>;

/** Android owns its unconfirmed selection; timer renders must not reopen its dialog. */
export function StableDateTimePicker(props: Props) {
  const initial = useRef(props).current;
  const change = useRef(props.onChange);
  useLayoutEffect(() => {
    change.current = props.onChange;
  }, [props.onChange]);
  const onChange = useCallback<NonNullable<Props['onChange']>>((event, selected) => {
    change.current?.(event, selected);
  }, []);
  return <DateTimePicker {...(Platform.OS === 'android' ? initial : props)} onChange={onChange} />;
}
