import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, {
  Path,
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  G,
  Rect,
} from 'react-native-svg';
import { colors } from '../theme/tokens';

interface ArtworkProps {
  style?: ViewStyle;
  height?: number;
}

/**
 * Morning Landscape with layered misty green hills and glowing rising sun.
 */
export const MorningSunriseLandscape: React.FC<ArtworkProps> = ({ style, height = 180 }) => {
  return (
    <View style={[styles.container, { height }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="morningSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F9F1E2" stopOpacity="0.95" />
            <Stop offset="40%" stopColor="#FDECD2" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#E9F2E7" stopOpacity="0.6" />
          </LinearGradient>
          <RadialGradient id="sunGlow" cx="0.8" cy="0.4" r="0.4">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <Stop offset="30%" stopColor="#FCDDA7" stopOpacity="0.7" />
            <Stop offset="60%" stopColor="#F8C982" stopOpacity="0.3" />
            <Stop offset="100%" stopColor="#F8C982" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="waterReflect" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#E8EFF1" stopOpacity="0.7" />
            <Stop offset="100%" stopColor="#D4E4E1" stopOpacity="0.9" />
          </LinearGradient>
          <LinearGradient id="hillBack" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#C9D8C5" stopOpacity="0.7" />
            <Stop offset="100%" stopColor="#A8BEA3" stopOpacity="0.9" />
          </LinearGradient>
          <LinearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#8EA987" stopOpacity="0.85" />
            <Stop offset="100%" stopColor="#6C8C64" stopOpacity="0.95" />
          </LinearGradient>
          <LinearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#4D7053" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#2E523A" stopOpacity="1" />
          </LinearGradient>
        </Defs>

        {/* Sky */}
        <Rect x="0" y="0" width="400" height="200" fill="url(#morningSky)" />

        {/* Glowing Sun Rings */}
        <Circle cx="320" cy="85" r="70" stroke="#FDE5B8" strokeWidth="1" opacity="0.4" fill="none" />
        <Circle cx="320" cy="85" r="50" stroke="#FDE5B8" strokeWidth="1.5" opacity="0.6" fill="none" />
        <Circle cx="320" cy="85" r="32" stroke="#FBD89A" strokeWidth="2" opacity="0.7" fill="none" />
        <Circle cx="320" cy="85" r="20" fill="url(#sunGlow)" />
        <Circle cx="320" cy="85" r="14" fill="#FFFFFF" opacity="0.95" />

        {/* Lake / Water Base */}
        <Path d="M120 130 C 200 120, 280 125, 400 135 L 400 200 L 0 200 L 0 145 Z" fill="url(#waterReflect)" />

        {/* Water Sunlight Shimmer */}
        <Path d="M 310 135 L 330 135 L 340 180 L 300 180 Z" fill="#FFF7E6" opacity="0.35" />

        {/* Distant Mountains */}
        <Path
          d="M 0 130 C 60 105, 140 115, 230 95 C 310 75, 360 90, 400 110 L 400 200 L 0 200 Z"
          fill="url(#hillBack)"
        />

        {/* Midground Soft Hills */}
        <Path
          d="M 0 150 C 90 125, 180 145, 290 120 C 350 105, 380 125, 400 140 L 400 200 L 0 200 Z"
          fill="url(#hillMid)"
        />

        {/* Foreground Lush Hill & Foliage */}
        <Path
          d="M -20 170 C 50 145, 110 160, 160 200 L -20 200 Z"
          fill="url(#hillFront)"
        />

        {/* Leaf Accents on Left */}
        <Path
          d="M 20 190 C 22 170, 35 155, 45 150 C 42 165, 38 180, 20 190 Z"
          fill="#3B6349"
          opacity="0.85"
        />
        <Path
          d="M 35 195 C 45 175, 60 168, 70 165 C 65 180, 55 190, 35 195 Z"
          fill="#537A5B"
          opacity="0.9"
        />
      </Svg>
    </View>
  );
};

/**
 * Open Day Golden Hills Landscape
 */
export const OpenDayLandscape: React.FC<ArtworkProps> = ({ style, height = 180 }) => {
  return (
    <View style={[styles.container, { height }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="daySky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFF9EB" />
            <Stop offset="100%" stopColor="#F5EEDB" />
          </LinearGradient>
          <LinearGradient id="dayHills1" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#E5CE9F" />
            <Stop offset="100%" stopColor="#CBB27E" />
          </LinearGradient>
          <LinearGradient id="dayHills2" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#BACBAA" />
            <Stop offset="100%" stopColor="#96AD84" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="200" fill="url(#daySky)" />

        {/* Golden Sun */}
        <Circle cx="300" cy="80" r="18" fill="#F4B84D" opacity="0.9" />

        {/* Golden layered path */}
        <Path
          d="M 0 140 C 120 110, 240 150, 400 100 L 400 200 L 0 200 Z"
          fill="url(#dayHills1)"
          opacity="0.5"
        />
        <Path
          d="M 0 165 C 100 135, 220 170, 400 130 L 400 200 L 0 200 Z"
          fill="url(#dayHills2)"
          opacity="0.8"
        />

        {/* Serene winding path */}
        <Path
          d="M 280 200 C 285 170, 310 150, 320 135 C 315 136, 295 155, 260 200 Z"
          fill="#FFF4DF"
          opacity="0.8"
        />
      </Svg>
    </View>
  );
};

/**
 * Evening Twilight / Night Landscape
 */
export const EveningTwilightLandscape: React.FC<ArtworkProps> = ({ style, height = 180 }) => {
  return (
    <View style={[styles.container, { height }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F5F1FA" />
            <Stop offset="50%" stopColor="#E9E2F3" />
            <Stop offset="100%" stopColor="#D5CBE5" />
          </LinearGradient>
          <LinearGradient id="nightHills1" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#B4A6CD" />
            <Stop offset="100%" stopColor="#8C7BA9" />
          </LinearGradient>
          <LinearGradient id="nightHills2" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#6C588A" />
            <Stop offset="100%" stopColor="#4A3866" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="200" fill="url(#nightSky)" />

        {/* Soft Crescent Moon */}
        <G transform="translate(320, 50)">
          <Circle cx="0" cy="0" r="16" fill="#F4EFE6" opacity="0.9" />
          <Circle cx="6" cy="-4" r="14" fill="#E9E2F3" />
        </G>

        {/* Tiny twinkling stars */}
        <Circle cx="80" cy="40" r="1.5" fill="#A89AC5" opacity="0.6" />
        <Circle cx="160" cy="65" r="1.5" fill="#A89AC5" opacity="0.8" />
        <Circle cx="240" cy="35" r="2" fill="#A89AC5" opacity="0.5" />
        <Circle cx="290" cy="80" r="1" fill="#A89AC5" opacity="0.7" />

        {/* Twilight layered mountains */}
        <Path
          d="M 0 135 C 100 110, 220 140, 400 110 L 400 200 L 0 200 Z"
          fill="url(#nightHills1)"
          opacity="0.6"
        />
        <Path
          d="M 0 160 C 130 140, 260 165, 400 135 L 400 200 L 0 200 Z"
          fill="url(#nightHills2)"
          opacity="0.85"
        />

        {/* Distant Pine Silhouettes */}
        <Path
          d="M 350 160 L 355 145 L 360 160 Z M 365 165 L 370 148 L 375 165 Z M 380 162 L 384 150 L 388 162 Z"
          fill="#3B2A56"
          opacity="0.8"
        />
      </Svg>
    </View>
  );
};

/**
 * Touch Grass Cooldown Meadow with Rabbit & Wildflowers
 */
export const TouchGrassMeadowLandscape: React.FC<ArtworkProps> = ({ style, height = 240 }) => {
  return (
    <View style={[styles.container, { height }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="meadowSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FCF7ED" />
            <Stop offset="50%" stopColor="#FEEFD8" />
            <Stop offset="100%" stopColor="#E9F2E7" />
          </LinearGradient>
          <LinearGradient id="meadowHills" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#C4D7BC" />
            <Stop offset="100%" stopColor="#8EA985" />
          </LinearGradient>
          <LinearGradient id="meadowForeground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#7B996E" />
            <Stop offset="100%" stopColor="#4A6D3F" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="240" fill="url(#meadowSky)" />

        {/* Radiant Sunrise */}
        <Circle cx="340" cy="70" r="26" fill="#FFFFFF" opacity="0.95" />
        <Circle cx="340" cy="70" r="40" stroke="#FDE5B8" strokeWidth="1.5" opacity="0.5" fill="none" />

        {/* Gentle Lake & River */}
        <Path d="M 120 120 C 220 110, 300 115, 400 125 L 400 240 L 0 240 L 0 135 Z" fill="#D2E3DF" opacity="0.8" />

        {/* Rolling Green Hills */}
        <Path
          d="M 0 130 C 80 100, 200 120, 400 95 L 400 240 L 0 240 Z"
          fill="url(#meadowHills)"
          opacity="0.75"
        />

        {/* Winding Trail */}
        <Path
          d="M 220 240 C 230 190, 260 160, 280 135 C 275 135, 245 165, 190 240 Z"
          fill="#EDE0C8"
          opacity="0.85"
        />

        {/* Foreground Meadow */}
        <Path
          d="M -20 180 C 80 150, 200 170, 420 155 L 420 240 L -20 240 Z"
          fill="url(#meadowForeground)"
          opacity="0.9"
        />

        {/* Gentle Rabbit Silhouette / Motif on Meadow Path */}
        <G transform="translate(105, 140) scale(0.65)">
          {/* Rabbit body */}
          <Path
            d="M 25 45 C 15 45, 5 55, 5 70 C 5 82, 18 90, 35 90 C 52 90, 60 80, 60 70 C 60 55, 45 45, 30 45 Z"
            fill="#D5B695"
          />
          {/* Rabbit head */}
          <Circle cx="45" cy="40" r="14" fill="#D5B695" />
          {/* Rabbit ears */}
          <Path d="M 42 30 C 40 15, 43 5, 47 6 C 51 7, 49 18, 47 30 Z" fill="#D5B695" />
          <Path d="M 48 30 C 49 18, 55 8, 58 10 C 61 12, 55 22, 52 30 Z" fill="#C9A37F" />
          {/* Rabbit tail */}
          <Circle cx="5" cy="72" r="6" fill="#F8EFE6" />
          {/* Eye */}
          <Circle cx="50" cy="38" r="2" fill="#594332" />
        </G>

        {/* Daisies & Wildflowers */}
        <G transform="translate(40, 195)">
          <Circle cx="0" cy="0" r="3" fill="#FEE358" />
          <Circle cx="-5" cy="0" r="3" fill="#FFFFFF" />
          <Circle cx="5" cy="0" r="3" fill="#FFFFFF" />
          <Circle cx="0" cy="-5" r="3" fill="#FFFFFF" />
          <Circle cx="0" cy="5" r="3" fill="#FFFFFF" />
        </G>
        <G transform="translate(70, 210)">
          <Circle cx="0" cy="0" r="2.5" fill="#FEE358" />
          <Circle cx="-4" cy="0" r="2.5" fill="#FFFFFF" />
          <Circle cx="4" cy="0" r="2.5" fill="#FFFFFF" />
          <Circle cx="0" cy="-4" r="2.5" fill="#FFFFFF" />
          <Circle cx="0" cy="4" r="2.5" fill="#FFFFFF" />
        </G>
        <G transform="translate(340, 190)">
          <Circle cx="0" cy="0" r="3" fill="#FEE358" />
          <Circle cx="-5" cy="0" r="3" fill="#FFFFFF" />
          <Circle cx="5" cy="0" r="3" fill="#FFFFFF" />
          <Circle cx="0" cy="-5" r="3" fill="#FFFFFF" />
          <Circle cx="0" cy="5" r="3" fill="#FFFFFF" />
        </G>

        {/* Framing Tree Leaves top-left */}
        <Path
          d="M -10 -10 C 40 30, 80 40, 130 30 C 90 60, 40 50, -10 -10 Z"
          fill="#355639"
          opacity="0.85"
        />
      </Svg>
    </View>
  );
};

/**
 * Onboarding Hero Graphic (Phone resting on stone in morning nature)
 */
export const OnboardingHeroArtwork: React.FC<ArtworkProps> = ({ style, height = 280 }) => {
  return (
    <View style={[styles.container, { height }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="onbSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F9F1E2" />
            <Stop offset="50%" stopColor="#FCECCE" />
            <Stop offset="100%" stopColor="#E4EEE0" />
          </LinearGradient>
          <LinearGradient id="stoneGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#DFD8C8" />
            <Stop offset="100%" stopColor="#B3AA97" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="300" fill="url(#onbSky)" />

        {/* Sunrise Glowing Radiance */}
        <Circle cx="300" cy="110" r="90" stroke="#FDE5B8" strokeWidth="1" opacity="0.3" fill="none" />
        <Circle cx="300" cy="110" r="60" stroke="#FDE5B8" strokeWidth="1.5" opacity="0.5" fill="none" />
        <Circle cx="300" cy="110" r="30" stroke="#FBD89A" strokeWidth="2" opacity="0.7" fill="none" />
        <Circle cx="300" cy="110" r="22" fill="#FFFFFF" />

        {/* Lake / Water Base with Sunbeam */}
        <Path d="M 0 160 C 150 140, 250 145, 400 165 L 400 300 L 0 300 Z" fill="#D7E6DF" opacity="0.85" />
        <Path d="M 285 160 L 315 160 L 330 220 L 270 220 Z" fill="#FFF8EB" opacity="0.5" />

        {/* Distant Hills */}
        <Path
          d="M 0 150 C 90 120, 200 135, 400 115 L 400 300 L 0 300 Z"
          fill="#A4BDA0"
          opacity="0.6"
        />

        {/* Smooth River Stone Platform */}
        <Path
          d="M 60 270 C 100 215, 300 210, 360 265 C 380 285, 340 310, 80 305 Z"
          fill="url(#stoneGrad)"
        />

        {/* Phone Resting Mindfully on Stone */}
        <G transform="translate(140, 195) rotate(-8)">
          <Rect
            x="0"
            y="0"
            width="130"
            height="68"
            rx="16"
            fill="#D2DFD2"
            stroke="#9EB79D"
            strokeWidth="2.5"
          />
          {/* Screen surface */}
          <Rect x="5" y="5" width="120" height="58" rx="12" fill="#E8EFE5" />
          {/* Subtle twin leaf motif on screen */}
          <Path
            d="M 65 34 C 60 24, 70 18, 75 22 C 78 28, 70 34, 65 34 Z"
            fill="#5E8367"
            opacity="0.8"
          />
          <Path
            d="M 65 34 C 55 35, 52 44, 58 45 C 64 45, 65 37, 65 34 Z"
            fill="#7B9E83"
            opacity="0.9"
          />
          {/* Speaker notch / mic */}
          <Circle cx="120" cy="34" r="2" fill="#8EA98E" />
        </G>

        {/* Lush Framing Reed & Leaves */}
        <Path
          d="M -10 260 C 20 180, 50 140, 70 120 C 60 170, 45 220, 10 290 Z"
          fill="#2C4E35"
        />
        <Path
          d="M 15 280 C 45 200, 80 160, 105 140 C 90 190, 70 240, 40 295 Z"
          fill="#446E4F"
        />
        <Path
          d="M 50 290 C 80 220, 115 185, 140 170 C 120 220, 95 260, 75 300 Z"
          fill="#638C6C"
        />

        {/* Plant Stem on Right */}
        <G transform="translate(340, 180)">
          <Path d="M 10 110 C 10 50, 20 10, 30 0" stroke="#3D5A43" strokeWidth="2.5" fill="none" />
          <Path d="M 28 8 C 40 0, 50 15, 30 20 Z" fill="#577D5E" />
          <Path d="M 20 38 C 0 32, 5 48, 22 45 Z" fill="#6A9271" />
          <Path d="M 24 68 C 42 62, 45 78, 26 76 Z" fill="#577D5E" />
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
});
