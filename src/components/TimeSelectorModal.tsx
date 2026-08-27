import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { Clock, Plus, Minus, X } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';

export const TimeSelectorModal: React.FC = () => {
  const timeSelector = usePrototypeStore((s) => s.timeSelector);
  const closeTimeSelector = usePrototypeStore((s) => s.closeTimeSelector);
  const saveSelectedTime = usePrototypeStore((s) => s.saveSelectedTime);

  const [hours, setHours] = useState(8);
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    if (timeSelector.initialTime) {
      const parts = timeSelector.initialTime.split(':');
      if (parts.length === 2) {
        setHours(parseInt(parts[0], 10) || 8);
        setMinutes(parseInt(parts[1], 10) || 0);
      }
    }
  }, [timeSelector.initialTime]);

  if (!timeSelector.visible) return null;

  const adjustHours = (delta: number) => {
    setHours((prev) => (prev + delta + 24) % 24);
  };

  const adjustMinutes = (delta: number) => {
    setMinutes((prev) => {
      const next = prev + delta;
      if (next >= 60) return 0;
      if (next < 0) return 45;
      return next;
    });
  };

  const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}`;

  const presets =
    hours < 12
      ? ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00']
      : ['20:30', '21:00', '21:30', '22:00', '22:30', '23:00'];

  const handleSave = () => {
    saveSelectedTime(formattedTime);
  };

  return (
    <View style={styles.overlay}>
      <TouchableWithoutFeedback onPress={closeTimeSelector}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <View style={styles.modalCard}>
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Clock size={20} color={colors.forest} />
            <Text style={styles.title}>
              {timeSelector.title || 'Adjust Routine Time'}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={closeTimeSelector}>
            <X size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Central Time Picker Stepper */}
        <View style={styles.stepperContainer}>
          {/* Hours Box */}
          <View style={styles.timeBox}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => adjustHours(1)}
            >
              <Plus size={20} color={colors.forest} />
            </TouchableOpacity>
            <Text style={styles.timeValueText}>
              {hours.toString().padStart(2, '0')}
            </Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => adjustHours(-1)}
            >
              <Minus size={20} color={colors.forest} />
            </TouchableOpacity>
            <Text style={styles.boxLabel}>Hours</Text>
          </View>

          <Text style={styles.colon}>:</Text>

          {/* Minutes Box */}
          <View style={styles.timeBox}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => adjustMinutes(15)}
            >
              <Plus size={20} color={colors.forest} />
            </TouchableOpacity>
            <Text style={styles.timeValueText}>
              {minutes.toString().padStart(2, '0')}
            </Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => adjustMinutes(-15)}
            >
              <Minus size={20} color={colors.forest} />
            </TouchableOpacity>
            <Text style={styles.boxLabel}>Minutes</Text>
          </View>
        </View>

        {/* Quick Preset Buttons */}
        <Text style={styles.presetLabel}>Quick Presets</Text>
        <View style={styles.presetRow}>
          {presets.map((preset) => {
            const isSelected = formattedTime === preset;
            return (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.presetChip,
                  isSelected && styles.presetChipSelected,
                ]}
                onPress={() => {
                  const [h, m] = preset.split(':');
                  setHours(parseInt(h, 10));
                  setMinutes(parseInt(m, 10));
                }}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    isSelected && styles.presetChipTextSelected,
                  ]}
                >
                  {preset}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Action Buttons */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeTimeSelector}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Save Time</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 75, 56, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 22,
    zIndex: 10000,
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: colors.backgroundMuted,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 14,
    gap: 16,
  },
  timeBox: {
    alignItems: 'center',
    backgroundColor: '#FAF8F4',
    padding: 12,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: '#EAE5DB',
    width: 96,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DFD9CD',
  },
  timeValueText: {
    fontSize: 36,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    marginVertical: 8,
  },
  boxLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 4,
  },
  colon: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.forest,
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 10,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EAE5DB',
  },
  presetChipSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  presetChipTextSelected: {
    color: '#FFFFFF',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: '#F3EFE6',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
