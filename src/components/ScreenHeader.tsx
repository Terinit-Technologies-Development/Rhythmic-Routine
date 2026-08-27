import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Sun, ChevronLeft, MoreHorizontal, Sparkles } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import Svg, { Path } from 'react-native-svg';

interface Props {
  title?: string;
  showWaveLogo?: boolean;
  subtitle?: string;
  showBack?: boolean;
  showMore?: boolean;
  onMorePress?: () => void;
}

export const ScreenHeader: React.FC<Props> = ({
  title = 'Rhythm',
  showWaveLogo = false,
  subtitle,
  showBack = false,
  showMore = false,
  onMorePress,
}) => {
  const router = useRouter();
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        {showBack ? (
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={colors.forestDark} strokeWidth={2.3} />
          </TouchableOpacity>
        ) : (
          <View style={styles.logoContainer}>
            <Text style={styles.brandTitle}>{title}</Text>
            {showWaveLogo && (
              <Svg width="36" height="8" viewBox="0 0 36 8" style={styles.waveSvg}>
                <Path
                  d="M 2 4 Q 10 0, 18 4 T 34 4"
                  stroke={colors.forest}
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              </Svg>
            )}
          </View>
        )}

        <View style={styles.actionsRow}>
          {showMore && (
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={onMorePress || (() => setDemoSwitcherVisible(true))}
            >
              <MoreHorizontal size={20} color={colors.forestDark} />
            </TouchableOpacity>
          )}

          {/* Sun / Demo State Selector Button */}
          <TouchableOpacity
            style={styles.sunBtn}
            onPress={() => setDemoSwitcherVisible(true)}
            activeOpacity={0.8}
          >
            <Sun size={20} color={colors.forestDark} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  logoContainer: {
    position: 'relative',
  },
  brandTitle: {
    fontSize: 28,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    letterSpacing: -0.5,
  },
  waveSvg: {
    position: 'absolute',
    bottom: -6,
    left: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E3D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E3D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 20,
  },
});
