import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../../src/theme/tokens';
import {
  OnboardingHeroArtwork,
  MorningSunriseLandscape,
  TouchGrassMeadowLandscape,
  EveningTwilightLandscape,
} from '../../src/components/Artwork';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import Svg, { Path } from 'react-native-svg';

export default function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = usePrototypeStore((s) => s.completeOnboarding);
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      title: 'Use your phone.\nJust don’t live in it.',
      description:
        'Rhythm helps you protect your mornings, wind down your evenings, and break long doomscrolling sessions with gentle recovery periods.',
      Artwork: OnboardingHeroArtwork,
    },
    {
      title: 'Morning Buffer &\nEvening Wind-Down',
      description:
        'Keep distracting feeds paused until your chosen morning hour, and rest peacefully with evening downtime.',
      Artwork: MorningSunriseLandscape,
    },
    {
      title: 'Group apps.\nManage the spiral.',
      description:
        'Group apps like X, Instagram, TikTok, and Reddit together. When continuous usage hits 30 mins, take a shared breather.',
      Artwork: TouchGrassMeadowLandscape,
    },
    {
      title: 'Touch Grass.\nReturn to living.',
      description:
        'Instead of shame-based lockouts, enjoy feel-good offline pauses — brew coffee, stretch, or read a chapter.',
      Artwork: EveningTwilightLandscape,
    },
  ];

  const handleFinish = () => {
    completeOnboarding();
    router.replace('/(tabs)/today');
  };

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      handleFinish();
    }
  };

  const slide = slides[currentSlide];
  const CurrentArtwork = slide.Artwork;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header Logo */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Text style={styles.brandTitle}>Rhythm</Text>
          <Svg width="36" height="8" viewBox="0 0 36 8" style={styles.waveSvg}>
            <Path
              d="M 2 4 Q 10 0, 18 4 T 34 4"
              stroke={colors.forest}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Headline */}
        <Text style={styles.title}>{slide.title}</Text>

        {/* Subtitle */}
        <Text style={styles.description}>{slide.description}</Text>

        {/* Scenic Illustration */}
        <View style={styles.artworkWrapper}>
          <CurrentArtwork height={280} />
        </View>
      </ScrollView>

      {/* Bottom Controls */}
      <View style={styles.footer}>
        {/* Primary Action Button */}
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={handleNext}
        >
          <Text style={styles.primaryBtnText}>
            {currentSlide === slides.length - 1 ? 'Get started' : 'Continue'}
          </Text>
        </TouchableOpacity>

        {/* Secondary Action */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.7}
          onPress={handleFinish}
        >
          <Text style={styles.secondaryBtnText}>Preview demo</Text>
        </TouchableOpacity>

        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          {slides.map((_, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => setCurrentSlide(index)}
              style={[
                styles.dot,
                index === currentSlide ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
  },
  header: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logoRow: {
    position: 'relative',
    alignSelf: 'flex-start',
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
  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 16,
    flexGrow: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 34,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 20,
  },
  artworkWrapper: {
    borderRadius: radii.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EAE5DB',
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    ...shadows.card,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 20,
    paddingTop: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.forest,
    paddingVertical: 16,
    borderRadius: radii.full,
    alignItems: 'center',
    marginBottom: 12,
    ...shadows.soft,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    paddingVertical: 8,
    marginBottom: 18,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.forestDark,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.forest,
  },
  dotInactive: {
    width: 8,
    backgroundColor: '#D7D0C0',
  },
});
