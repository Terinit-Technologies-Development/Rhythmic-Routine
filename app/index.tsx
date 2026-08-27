import React from 'react';
import { Redirect } from 'expo-router';
import { usePrototypeStore } from '../src/store/usePrototypeStore';

export default function Index() {
  const hasCompletedOnboarding = usePrototypeStore((s) => s.hasCompletedOnboarding);

  if (!hasCompletedOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/today" />;
}
