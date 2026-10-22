import type { Weather } from '@carpool/shared'
import { weatherKind } from './format'

const ICON = { sun: '☀️', cloud: '☁️', rain: '🌧️' }

/** 晴、多雲、雨 (SC-X4); the station's own words are the accessible name. */
export function WeatherIcon({ weather }: { weather: Weather | null }) {
  if (!weather) return <span className="text-sm text-ink-soft">—</span>
  return (
    <span role="img" aria-label={weather.weather} title={`${weather.weather} ${weather.air_temperature}°C`} className="text-base leading-none">
      {ICON[weatherKind(weather)]}
    </span>
  )
}
