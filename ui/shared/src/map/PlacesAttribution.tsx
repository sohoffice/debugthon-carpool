import logo from './google-maps-logo.svg'

/**
 * The Google Maps logo under Places suggestions. Google requires it wherever Places results are
 * shown without a visible Google map: the official gray logo for a plain background, unmodified,
 * 16–19px high, with clear space around it (Google Maps Platform attribution policy).
 */
export function PlacesAttribution() {
  return (
    <p className="pt-2.5 pb-1.5 pl-2.5">
      <img src={logo} alt="Google Maps" width={98} height={18} translate="no" />
    </p>
  )
}
