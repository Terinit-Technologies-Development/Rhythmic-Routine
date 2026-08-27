import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Phone,
  MessageCircle,
  PlaySquare,
  Camera,
  AtSign,
  Music,
  Flame,
  Headphones,
  Calendar,
  MapPin,
  Mail,
  Tv,
  FileText,
  Image,
  Settings,
  Navigation,
  BookOpen,
  MessageSquare,
  Award,
  Hash,
  Clock,
  Divide,
  ChevronRight,
  AppWindow,
} from 'lucide-react-native';
import { XLogoIcon } from './BrandIcons';
import { DeviceApp } from '../types/domain';
import { AppClassificationPill } from './AppClassificationPill';
import { colors, radii } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';

interface Props {
  app: DeviceApp;
  showDivider?: boolean;
}

export const AppRow: React.FC<Props> = ({ app, showDivider = true }) => {
  const openAppEdit = usePrototypeStore((s) => s.openAppEdit);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);

  const groupName = app.riskGroupId
    ? riskGroups.find((g) => g.id === app.riskGroupId)?.name
    : null;

  const renderIcon = () => {
    const iconProps = { size: 22, color: app.iconColor || colors.forest };
    switch (app.iconName) {
      case 'phone':
        return <Phone {...iconProps} />;
      case 'message-circle':
        return <MessageCircle {...iconProps} />;
      case 'play-square':
        return <PlaySquare {...iconProps} />;
      case 'twitter':
        return <XLogoIcon size={20} color={app.iconColor || '#000000'} />;
      case 'camera':
        return <Camera {...iconProps} />;
      case 'at-sign':
        return <AtSign {...iconProps} />;
      case 'music':
        return <Music {...iconProps} />;
      case 'flame':
        return <Flame {...iconProps} />;
      case 'headphones':
        return <Headphones {...iconProps} />;
      case 'calendar':
        return <Calendar {...iconProps} />;
      case 'map-pin':
        return <MapPin {...iconProps} />;
      case 'mail':
        return <Mail {...iconProps} />;
      case 'tv':
        return <Tv {...iconProps} />;
      case 'file-text':
        return <FileText {...iconProps} />;
      case 'image':
        return <Image {...iconProps} />;
      case 'settings':
        return <Settings {...iconProps} />;
      case 'navigation':
        return <Navigation {...iconProps} />;
      case 'book-open':
        return <BookOpen {...iconProps} />;
      case 'message-square':
        return <MessageSquare {...iconProps} />;
      case 'award':
        return <Award {...iconProps} />;
      case 'hash':
        return <Hash {...iconProps} />;
      case 'clock':
        return <Clock {...iconProps} />;
      case 'divide':
        return <Divide {...iconProps} />;
      default:
        return <AppWindow {...iconProps} />;
    }
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => openAppEdit(app.id)}
      >
        {/* App Icon Tile */}
        <View style={[styles.iconTile, { backgroundColor: app.iconBg || '#F5F5F5' }]}>
          {renderIcon()}
        </View>

        {/* App Title & Subtitle */}
        <View style={styles.infoCol}>
          <Text style={styles.appName}>{app.name}</Text>
          {groupName ? (
            <Text style={styles.groupSubtitle}>Group: {groupName}</Text>
          ) : (
            <Text style={styles.categorySubtitle}>{app.defaultCategory}</Text>
          )}
        </View>

        {/* Classification Badge & Chevron */}
        <View style={styles.rightCol}>
          <AppClassificationPill classification={app.classification} />
          <ChevronRight size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />
        </View>
      </TouchableOpacity>

      {showDivider && <View style={styles.divider} />}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  appName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  groupSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  categorySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rightCol: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3EFE6',
    marginLeft: 74,
  },
});
