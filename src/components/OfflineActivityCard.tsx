import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { OfflineActivity } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';

interface Props {
  activity: OfflineActivity;
  onPress?: () => void;
}

export const OfflineActivityCard: React.FC<Props> = ({ activity, onPress }) => {
  const getBadgeBg = () => {
    switch (activity.category) {
      case 'grounding':
        return colors.amberLight;
      case 'movement':
        return colors.sageLight;
      case 'mind':
        return colors.lavenderLight;
      case 'nature':
      default:
        return colors.skyLight;
    }
  };

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <View style={[styles.emojiCircle, { backgroundColor: getBadgeBg() }]}>
        <Text style={styles.emojiText}>{activity.iconEmoji}</Text>
      </View>

      <View style={styles.contentCol}>
        <Text style={styles.title}>{activity.title}</Text>
        <Text style={styles.subtitle}>{activity.subtitle}</Text>
      </View>

      <ChevronRight size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 10,
    ...shadows.soft,
  },
  emojiCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  emojiText: {
    fontSize: 22,
  },
  contentCol: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
