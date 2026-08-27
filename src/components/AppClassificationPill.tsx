import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Check, AlertTriangle, Scale, HelpCircle } from 'lucide-react-native';
import { AppClassification } from '../types/domain';
import { colors, radii } from '../theme/tokens';

interface Props {
  classification: AppClassification;
  style?: ViewStyle;
  size?: 'sm' | 'md';
}

export const AppClassificationPill: React.FC<Props> = ({
  classification,
  style,
  size = 'md',
}) => {
  const isSm = size === 'sm';
  const iconSize = isSm ? 12 : 14;

  switch (classification) {
    case 'essential':
      return (
        <View style={[styles.pill, styles.essentialBg, isSm && styles.pillSm, style]}>
          <Check size={iconSize} color={colors.badgeGreenText} strokeWidth={2.5} />
          <Text style={[styles.text, styles.essentialText, isSm && styles.textSm]}>Essential</Text>
        </View>
      );
    case 'risk':
      return (
        <View style={[styles.pill, styles.riskBg, isSm && styles.pillSm, style]}>
          <AlertTriangle size={iconSize} color={colors.badgeRedText} strokeWidth={2.5} />
          <Text style={[styles.text, styles.riskText, isSm && styles.textSm]}>Risk</Text>
        </View>
      );
    case 'normal':
      return (
        <View style={[styles.pill, styles.normalBg, isSm && styles.pillSm, style]}>
          <Scale size={iconSize} color={colors.badgeAmberText} strokeWidth={2.5} />
          <Text style={[styles.text, styles.normalText, isSm && styles.textSm]}>Normal</Text>
        </View>
      );
    case 'unclassified':
    default:
      return (
        <View style={[styles.pill, styles.unclassifiedBg, isSm && styles.pillSm, style]}>
          <HelpCircle size={iconSize} color={colors.badgeGrayText} strokeWidth={2.5} />
          <Text style={[styles.text, styles.unclassifiedText, isSm && styles.textSm]}>
            Unclassified
          </Text>
        </View>
      );
  }
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    gap: 5,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
  textSm: {
    fontSize: 11,
  },
  essentialBg: {
    backgroundColor: colors.badgeGreenBg,
  },
  essentialText: {
    color: colors.badgeGreenText,
  },
  riskBg: {
    backgroundColor: colors.badgeRedBg,
  },
  riskText: {
    color: colors.badgeRedText,
  },
  normalBg: {
    backgroundColor: colors.badgeAmberBg,
  },
  normalText: {
    color: colors.badgeAmberText,
  },
  unclassifiedBg: {
    backgroundColor: colors.badgeGrayBg,
  },
  unclassifiedText: {
    color: colors.badgeGrayText,
  },
});
