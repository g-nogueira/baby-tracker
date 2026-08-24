import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { DiaperType } from '@baby-tracker/domain';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import {
  ActivityTimestampField,
  type ActivityTimestampPickerMode,
} from '@/features/shared/activity-drawer/activity-timestamp-field';
import {
  careEventDraftError,
  type CareEventDrawerState,
  selectDiaperType,
  updateCareEventOccurredAt,
  updateMedicineNote,
} from './care-event-drawer-state';

interface CareEventDrawerProps {
  draft: CareEventDrawerState;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (draft: CareEventDrawerState) => void;
  onDelete: (() => void) | null;
  onSave: (draft: CareEventDrawerState) => void;
}

const diaperChoices: readonly { type: DiaperType; label: string; icon: string }[] = [
  { type: 'dry', label: 'Dry', icon: '○' },
  { type: 'wet', label: 'Wet', icon: '●' },
  { type: 'dirty', label: 'Dirty', icon: '◆' },
  { type: 'mixed', label: 'Mixed', icon: '◐' },
];

/** Renders accessible create/edit controls for one typed CareEvent draft. */
export function CareEventDrawer({
  draft,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: CareEventDrawerProps) {
  const [pickerMode, setPickerMode] = useState<ActivityTimestampPickerMode | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const validationError = careEventDraftError(draft);
  const selectionRequired = draft.kind === 'diaper' && draft.diaperType === null;
  const saveDisabled = isMutating || selectionRequired;
  const title = `${draft.mode === 'edit' ? 'Edit ' : ''}${draft.kind === 'diaper' ? 'Diaper' : 'Medicine'}`;

  const handleTimestampChange = (event: DateTimePickerEvent, selected?: Date) => {
    const activeMode = pickerMode;
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type === 'dismissed' || selected === undefined || activeMode === null) return;
    try {
      const next =
        activeMode === 'date'
          ? mergeDatePart(draft.occurredAt, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone)
          : mergeTimePart(draft.occurredAt, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
      setPickerError(null);
      setSubmitted(false);
      onChange(updateCareEventOccurredAt(draft, next));
    } catch {
      setPickerError('Choose another date or time and try again.');
    }
  };

  const submit = () => {
    setSubmitted(true);
    if (validationError === null && pickerError === null) onSave(draft);
  };

  return (
    <ActivityDrawer
      activityLabel={draft.kind === 'diaper' ? 'Diaper' : 'Medicine'}
      mode={draft.mode === 'edit' ? 'edit' : 'create'}
      onDismiss={onCancel}
      scrollContent
    >
      {({ expanded }) => (
        <>
          <View style={styles.hero}>
            <View
              style={[
                styles.iconCircle,
                draft.kind === 'medicine' ? styles.medicineSoft : styles.diaperSoft,
              ]}
            >
              <Text
                style={[
                  styles.heroIcon,
                  draft.kind === 'medicine' ? styles.medicineInk : styles.diaperInk,
                ]}
              >
                {draft.kind === 'medicine' ? '+' : 'D'}
              </Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          </View>

          {draft.kind === 'diaper' ? (
            <View style={styles.choiceGrid}>
              {diaperChoices.map((choice) => {
                const selected = draft.diaperType === choice.type;
                return (
                  <Pressable
                    accessibilityLabel={`${choice.label} diaper type${selected ? ', selected' : ''}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: isMutating, disabled: isMutating, selected }}
                    disabled={isMutating}
                    key={choice.type}
                    onPress={() => {
                      setSubmitted(false);
                      onChange(selectDiaperType(draft, choice.type));
                    }}
                    style={({ pressed }) => [
                      styles.choice,
                      selected && styles.choiceSelected,
                      isMutating && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
                      {choice.icon}
                    </Text>
                    <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
                      {choice.label}
                    </Text>
                    <Text style={styles.choiceState}>{selected ? 'Selected' : 'Choose'}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.noteField}>
              <Text style={styles.noteLabel}>What was given?</Text>
              <TextInput
                accessibilityLabel="Medicine note"
                editable={!isMutating}
                multiline
                onChangeText={(note) => {
                  setSubmitted(false);
                  onChange(updateMedicineNote(draft, note));
                }}
                placeholder="Medicine note"
                placeholderTextColor="#918B83"
                style={styles.noteInput}
                textAlignVertical="top"
                value={draft.note}
              />
            </View>
          )}

          <Pressable
            accessibilityLabel={
              draft.mode === 'edit' ? 'Save care event changes' : `Save ${draft.kind}`
            }
            accessibilityRole="button"
            accessibilityState={{ busy: isMutating, disabled: saveDisabled }}
            disabled={saveDisabled}
            onPress={submit}
            style={({ pressed }) => [
              styles.saveButton,
              draft.kind === 'medicine' ? styles.medicineButton : styles.diaperButton,
              saveDisabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveText}>{draft.mode === 'edit' ? 'Save changes' : 'Save'}</Text>
          </Pressable>

          {!expanded ? (
            <Text style={styles.swipeHint}>Swipe up for exact date and time</Text>
          ) : null}

          {expanded ? (
            <View style={styles.expandedContent}>
              <Text style={styles.optionsTitle}>Date and time</Text>
              <ActivityTimestampField
                label="Occurred"
                maximumDate={new Date()}
                onDone={() => setPickerMode(null)}
                onPick={setPickerMode}
                onPickerChange={handleTimestampChange}
                pickerMode={pickerMode}
                timezone={LOCAL_DEVELOPMENT_IDENTITY.dayTimezone}
                value={draft.occurredAt}
              />
              {onDelete === null ? null : (
                <Pressable
                  accessibilityLabel={`Delete ${draft.kind} event`}
                  accessibilityRole="button"
                  disabled={isMutating}
                  onPress={onDelete}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteText}>Delete {draft.kind}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {submitted && validationError !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {validationError}
            </Text>
          ) : null}
          {pickerError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {pickerError}
            </Text>
          )}
          {mutationError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {mutationError}
            </Text>
          )}
        </>
      )}
    </ActivityDrawer>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6 },
  iconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  diaperSoft: { backgroundColor: '#E6F0EA' },
  medicineSoft: { backgroundColor: '#F8E9DE' },
  heroIcon: { fontSize: 21, fontWeight: '900' },
  diaperInk: { color: '#47735A' },
  medicineInk: { color: '#A65F35' },
  title: { color: '#292724', fontSize: 18, fontWeight: '700' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    width: '48%',
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 2,
    borderColor: '#E7E0D7',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  choiceSelected: { borderColor: '#47735A', backgroundColor: '#E6F0EA' },
  choiceIcon: { color: '#746F68', fontSize: 19, fontWeight: '900' },
  choiceIconSelected: { color: '#315C43' },
  choiceLabel: { color: '#292724', fontSize: 15, fontWeight: '800' },
  choiceLabelSelected: { color: '#315C43' },
  choiceState: { color: '#746F68', fontSize: 11 },
  noteField: { gap: 7 },
  noteLabel: { color: '#292724', fontSize: 14, fontWeight: '700' },
  noteInput: {
    minHeight: 96,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D8D0C7',
    borderRadius: 14,
    color: '#292724',
    backgroundColor: '#FFFFFF',
    fontSize: 16,
  },
  saveButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  diaperButton: { backgroundColor: '#47735A' },
  medicineButton: { backgroundColor: '#A65F35' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  swipeHint: { color: '#746F68', fontSize: 12, textAlign: 'center' },
  expandedContent: { gap: 12, paddingTop: 2 },
  optionsTitle: { color: '#292724', fontSize: 15, fontWeight: '800' },
  deleteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#A64444', fontSize: 15, fontWeight: '700' },
  errorText: { color: '#A64444', fontSize: 13, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
