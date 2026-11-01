export interface EmergencyAccessPresentation {
  message: string;
  actionLabel: string;
  morningFocusActive: boolean;
  preservesMorningFocus: boolean;
}

/** Describe the authorized cooldown/activity pause without promising a morning bypass. */
export function deriveEmergencyAccessPresentation(input: {
  morningFocusActive: boolean;
  durationMinutes: number;
  groupName?: string;
}): EmergencyAccessPresentation {
  const requestLine = `This request is for ${input.durationMinutes} minutes of emergency access for ${input.groupName ?? 'the selected group'}. Your accountability settings still apply.`;
  const focusLine = input.morningFocusActive
    ? 'Morning focus is still active. Emergency access can pause the cooldown and reading or meditation task for this group, but managed apps stay blocked until your morning meditation is verified.'
    : 'Emergency access can pause the cooldown and reading or meditation task for this group. Morning meditation remains required whenever morning focus is active.';
  return {
    message: [
      'Take a gentle breath.',
      requestLine,
      focusLine,
      'The cooldown timer keeps running. When emergency access ends, limits for the selected group apply again.',
    ].join('\n\n'),
    actionLabel: input.morningFocusActive
      ? 'Request emergency access'
      : `Grant ${input.durationMinutes}-Min Emergency Access`,
    morningFocusActive: input.morningFocusActive,
    preservesMorningFocus: true,
  };
}
