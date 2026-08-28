export interface NativePermissionStatus {
  hasUsagePermission: boolean;
  hasRestrictionPermission: boolean;
  familyControlsStatus: 'unknown' | 'approved' | 'denied' | 'revoked' | 'unsupported';
}

export interface NativeUsageEvent {
  packageName: string;
  timestamp: number;
  eventType: 'foreground' | 'background' | 'unknown';
}

export interface NativeAppInfo {
  packageName: string;
  appName: string;
  category?: string;
  iconUri?: string;
}
