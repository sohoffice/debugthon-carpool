import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useMemo } from 'react'
import type { Place } from '../api/types'
import { MAPS_API_KEY } from './config'

/** One match while typing; its position is looked up only when chosen. */
export interface PlaceSuggestion {
  id: string
  name: string
  /** The rest of the address, e.g. the district. */
  detail: string
  resolve: () => Promise<Place>
}

export interface PlaceSearcher {
  suggest: (query: string) => Promise<PlaceSuggestion[]>
}

/**
 * The park's bounding box with a small margin. Places restricts only to a rectangle; whether a
 * place is really inside the park is the backend's call (DD-32).
 */
const PARK_BOUNDS = { south: 25.048, west: 121.555, north: 25.091, east: 121.588 }

function createSearcher(places: google.maps.PlacesLibrary): PlaceSearcher {
  // One billing session from the first keystroke to the chosen place's details.
  let sessionToken = new places.AutocompleteSessionToken()
  return {
    async suggest(input) {
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken,
        locationRestriction: PARK_BOUNDS,
        language: 'zh-TW',
        region: 'tw',
      })
      return suggestions.flatMap(({ placePrediction: p }) => {
        if (!p) return []
        const name = p.mainText?.text ?? p.text.text
        const resolve = async (): Promise<Place> => {
          const place = p.toPlace()
          await place.fetchFields({ fields: ['location'] })
          sessionToken = new places.AutocompleteSessionToken()
          if (!place.location) throw new Error('place has no location')
          return { name, lat: place.location.lat(), lng: place.location.lng() }
        }
        return [{ id: p.placeId, name, detail: p.secondaryText?.text ?? '', resolve }]
      })
    },
  }
}

function useGooglePlaceSearch(): PlaceSearcher | null {
  const places = useMapsLibrary('places')
  return useMemo(() => (places ? createSearcher(places) : null), [places])
}

/**
 * Google Places autocomplete for destinations (DD-32). Null without a Maps key or until the
 * library has loaded: the prefilled destination still works then.
 */
export const usePlaceSearch: () => PlaceSearcher | null = MAPS_API_KEY ? useGooglePlaceSearch : () => null
