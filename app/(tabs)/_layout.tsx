import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Tabs } from 'expo-router';
import { Sun, Calendar, LayoutGrid, BarChart2 } from 'lucide-react-native';
import { colors } from '../../src/theme/tokens';
import { SafeAreaView } from 'react-native-safe-area-context';

type CustomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

function CustomTabBar({ state, descriptors, navigation }: CustomTabBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.tabBarContainer}>
      <View style={styles.tabBarContent}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const getTabIcon = () => {
            const iconColor = isFocused ? colors.forestDark : colors.textMuted;
            const strokeWidth = isFocused ? 2.4 : 1.8;

            switch (route.name) {
              case 'today':
                return <Sun size={22} color={iconColor} strokeWidth={strokeWidth} />;
              case 'routine':
                return <Calendar size={22} color={iconColor} strokeWidth={strokeWidth} />;
              case 'apps':
                return <LayoutGrid size={22} color={iconColor} strokeWidth={strokeWidth} />;
              case 'insights':
                return <BarChart2 size={22} color={iconColor} strokeWidth={strokeWidth} />;
              default:
                return <Sun size={22} color={iconColor} strokeWidth={strokeWidth} />;
            }
          };

          const getTabLabel = () => {
            switch (route.name) {
              case 'today':
                return 'Today';
              case 'routine':
                return 'Routine';
              case 'apps':
                return 'Apps';
              case 'insights':
                return 'Insights';
              default:
                return route.name;
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
              <View style={styles.iconContainer}>{getTabIcon()}</View>
              <Text
                style={[
                  styles.tabLabel,
                  isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
                ]}
              >
                {getTabLabel()}
              </Text>
              {isFocused && <View style={styles.activeBar} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="routine" options={{ title: 'Routine' }} />
      <Tabs.Screen name="apps" options={{ title: 'Apps' }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECE7DC',
  },
  tabBarContent: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    position: 'relative',
    paddingTop: 4,
  },
  iconContainer: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 3,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.forestDark,
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: colors.textMuted,
  },
  activeBar: {
    position: 'absolute',
    bottom: 2,
    width: 20,
    height: 3,
    backgroundColor: colors.forest,
    borderRadius: 2,
  },
});
