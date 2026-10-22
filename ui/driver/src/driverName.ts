/**
 * The person's name from the profile's display_name (DD-35). Seeded names carry the role ("駕駛 阿丁"),
 * which the account tag and the drawer already say next to it (SC-D5), so it is dropped here.
 */
export function personName(displayName: string): string {
  return displayName.replace(/^駕駛\s*/, '') || displayName
}
