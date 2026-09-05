export function isGeneralCoupleOnboardingEnabled(): boolean {
  return import.meta.env.VITE_GENERAL_COUPLE_ONBOARDING_ENABLED === 'true';
}
