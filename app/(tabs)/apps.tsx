import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { AppRow } from '../../src/components/AppRow';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import { AppClassification } from '../../src/types/domain';

export default function AppsScreen() {
  const apps = usePrototypeStore((s) => s.apps);
  const searchQuery = usePrototypeStore((s) => s.searchQuery);
  const setSearchQuery = usePrototypeStore((s) => s.setSearchQuery);
  const filterClassification = usePrototypeStore((s) => s.filterClassification);
  const setFilterClassification = usePrototypeStore((s) => s.setFilterClassification);

  const [expanded, setExpanded] = useState(false);

  const filterChips: { id: AppClassification | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'essential', label: 'Essential' },
    { id: 'normal', label: 'Normal' },
    { id: 'risk', label: 'Risk' },
    { id: 'unclassified', label: 'Unclassified' },
  ];

  // Filtering
  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.defaultCategory.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter =
      filterClassification === 'all' || app.classification === filterClassification;

    return matchesSearch && matchesFilter;
  });

  const displayedApps = expanded ? filteredApps : filteredApps.slice(0, 7);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Apps"
        subtitle="Choose what protects your attention."
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Search Bar & Filter Button */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Search size={18} color={colors.textSecondary} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search apps"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <TouchableOpacity
            style={styles.filterIconButton}
            activeOpacity={0.8}
            onPress={() => {
              // Cycle or toggle filter
              const currentIndex = filterChips.findIndex((c) => c.id === filterClassification);
              const nextIndex = (currentIndex + 1) % filterChips.length;
              setFilterClassification(filterChips[nextIndex].id);
            }}
          >
            <SlidersHorizontal size={18} color={colors.forestDark} />
          </TouchableOpacity>
        </View>

        {/* Filter Chips Horizontal Scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsRow}
        >
          {filterChips.map((chip) => {
            const isSelected = filterClassification === chip.id;
            return (
              <TouchableOpacity
                key={chip.id}
                style={[
                  styles.filterChip,
                  isSelected && styles.filterChipSelected,
                ]}
                onPress={() => setFilterClassification(chip.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isSelected && styles.filterChipTextSelected,
                  ]}
                >
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Installed Apps Card Container */}
        <View style={styles.appsCard}>
          {/* Card Header */}
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Installed apps</Text>
            <Text style={styles.appsCountBadge}>{filteredApps.length} apps</Text>
          </View>

          {/* App Rows List */}
          <View style={styles.appList}>
            {displayedApps.map((app, index) => (
              <AppRow
                key={app.id}
                app={app}
                showDivider={index < displayedApps.length - 1}
              />
            ))}

            {filteredApps.length === 0 && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No apps match the current filter.</Text>
              </View>
            )}
          </View>

          {/* Show More / Show Less Accordion Button */}
          {filteredApps.length > 7 && (
            <TouchableOpacity
              style={styles.showMoreBtn}
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.7}
            >
              <Text style={styles.showMoreText}>
                {expanded ? 'Show less' : `Show more (${filteredApps.length - 7} more)`}
              </Text>
              {expanded ? (
                <ChevronUp size={16} color={colors.forest} />
              ) : (
                <ChevronDown size={16} color={colors.forest} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    ...shadows.soft,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  filterIconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EFEAE0',
    ...shadows.soft,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE5DB',
  },
  filterChipSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextSelected: {
    color: '#FFFFFF',
  },
  appsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    overflow: 'hidden',
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F4EFE6',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  appsCountBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  appList: {
    paddingVertical: 4,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F4EFE6',
    backgroundColor: '#FAF8F4',
    gap: 6,
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.forest,
  },
});
