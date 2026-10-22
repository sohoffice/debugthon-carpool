import logo from './google-maps-logo.svg'

/**
 * The Google Maps logo under Places suggestions. Google requires it wherever Places results are
 * shown without a visible Google map: the official gray logo for a plain background, unmodified,
 * 16–19px high, with clear space around it (Google Maps Platform attribution policy). It sits on
 * its own white plate, so the gray logo keeps a plain light background on the driver's asphalt too.
 */
export function PlacesAttribution() {
  return (
    <p className="mt-2 inline-flex rounded-[6px] bg-white px-2.5 py-2">
      <img src={logo} alt="Google Maps" width={98} height={18} translate="no" />
    </p>
  )
}
