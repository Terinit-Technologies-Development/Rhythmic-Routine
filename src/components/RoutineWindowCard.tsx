import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Sprout, Sun, Moon, Edit3, Infinity } from 'lucide-react-native';
import { RoutineWindow } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';
import {
  MorningSunriseLandscape,
  OpenDayLandscape,
  EveningTwilightLandscape,
} from './Artwork';
import { usePrototypeStore } from '../store/usePrototypeStore';

interface Props {
  window: RoutineWindow;
  timeLabel: string;
}

export const RoutineWindowCard: React.FC<Props> = ({ window, timeLabel }) => {
  const openTimeSelector = usePrototypeStore((s) => s.openTimeSelector);

  const getArtwork = () => {
    switch (window.type) {
      case 'morning-buffer':
        return MorningSunriseLandscape;
      case 'open-day':
        return OpenDayLandscape;
      case 'evening-wind-down':
      default:
        return EveningTwilightLandscape;
    }
  };

  const getIcon = () => {
    switch (window.type) {
      case 'morning-buffer':
        return <Sprout size={20} color={colors.forest} strokeWidth={2.3} />;
      case 'open-day':
        return <Sun size={20} color={colors.amberDark} strokeWidth={2.3} />;
      case 'evening-wind-down':
      default:
        return <Moon size={20} color={colors.lavenderDark} strokeWidth={2.3} />;
    }
  };

  const getIconBg = () => {
    switch (window.type) {
      case 'morning-buffer':
        return colors.sageLight;
      case 'open-day':
        return colors.amberLight;
      case 'evening-wind-down':
      default:
        return colors.lavenderLight;
    }
  };

  const ArtworkComponent = getArtwork();

  const handleEditTime = () => {
    openTimeSelector({
      windowId: window.id,
      field: 'startTime',
      title: window.type === 'morning-buffer' ? 'Morning Buffer Unlock' : 'Wind-Down Start',
      initialTime: window.startTime,
    });
  };

  return (
    <View style={styles.wrapper}>
      {/* Left Timeline Rail Column */}
      <View style={styles.timelineCol}>
        <View style={[styles.nodeCircle, { backgroundColor: getIconBg() }]}>
          {getIcon()}
        </View>
        <Text style={styles.timeRailLabel}>{timeLabel}</Text>
        <View style={styles.verticalRail} />
      </View>

      {/* Main Routine Card */}
      <View style={styles.cardContainer}>
        {/* Background Landscape Artwork */}
        <View style={styles.artworkWrapper}>
          <ArtworkComponent height={170} />
        </View>

        {/* Foreground Content */}
        <View style={styles.cardContent}>
          <Text style={styles.windowTitle}>{window.name}</Text>
          <Text style={styles.tagline}>{window.tagline}</Text>

          {/* Time Picker Pill or Badge */}
          {window.type === 'open-day' ? (
            <View style={styles.openDayBadge}>
              <Text style={styles.openDayBadgeText}>No limits set</Text>
              <Infinity size={16} color={colors.amberDark} style={{ marginLeft: 6 }} />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.timePill}
              activeOpacity={0.8}
              onPress={handleEditTime}
            >
              <Text style={styles.timePillText}>{window.startTime}</Text>
              <Edit3 size={14} color={colors.forest} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          )}

          <Text style={styles.description}>{window.description}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  timelineCol: {
    width: 68,
    alignItems: 'center',
    paddingTop: 8,
    position: 'relative',
  },
  nodeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    zIndex: 2,
  },
  timeRailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  verticalRail: {
    position: 'absolute',
    top: 54,
    bottom: -16,
    width: 2,
    backgroundColor: '#E6E0D3',
    zIndex: 1,
  },
  cardContainer: {
    flex: 1,
    borderRadius: radii.xl,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EFEAE0',
    minHeight: 160,
    position: 'relative',
    ...shadows.card,
  },
  artworkWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardContent: {
    padding: 16,
    flex: 1,
    justifyContent: 'space-between',
  },
  windowTitle: {
    fontSize: 18,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.text,
  },
  tagline: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 8,
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#DFD9CD',
    marginBottom: 10,
    ...shadows.soft,
  },
  timePillText: {
    fontSize: 16,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  openDayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#DFD9CD',
    marginBottom: 10,
  },
  openDayBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.amberDark,
  },
  description: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
