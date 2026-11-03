import { TRACKING_CONSENT_VERSION, type Profile } from "@/lib/api-types";

/** Has the member agreed to save tracking data, under the current consent copy (ADR-0011 §4)? */
export function hasTrackingConsent(profile: Profile | null): boolean {
  return (
    profile?.tracking_data_consent_at != null &&
    (profile.tracking_data_consent_version ?? 0) >= TRACKING_CONSENT_VERSION
  );
}
