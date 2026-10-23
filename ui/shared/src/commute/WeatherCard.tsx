import type { CommuteWeather } from '../api/types'
import { SimulatedBadge } from '../ui/SimulatedBadge'
import { formatMinutes, isoWeekdayOf, taipeiMinutes, weatherKind, weekdayName } from './slots'
import { WeatherIcon } from './WeatherIcon'

/** Today's weather from /api/commute/weather (REQ-077), marked 「天氣模擬」 by weather_simulated (REQ-063): "陰有雨 18°C／內湖站 08:10 觀測 … 今天 10/26 週一". */
export function WeatherCard({ data }: { data: CommuteWeather }) {
  const [, month, day] = data.today.split('-').map(Number)
  const w = data.weather
  return (
    <section aria-label="今天的天氣" className="flex items-center gap-3.5 rounded-control bg-sunk px-3.5 py-3">
      {w && <WeatherIcon kind={weatherKind(w.weather)} className="size-[38px] shrink-0" />}
      <div className="min-w-0">
        {w ? (
          <>
            <p className="text-xl font-semibold">{`${w.weather} ${Math.round(w.air_temperature)}°C`}</p>
            <p className="text-sm text-fg-soft">{`${w.station_name}站 ${formatMinutes(taipeiMinutes(w.obs_time))} 觀測`}</p>
          </>
        ) : (
          <p className="text-base">今天還沒有天氣觀測</p>
        )}
        {data.weather_simulated && (
          <div className="mt-1">
            <SimulatedBadge label="天氣模擬" />
          </div>
        )}
      </div>
      <p className="ml-auto shrink-0 text-right text-sm/snug text-fg-soft">
        今天
        <b className="block text-[22px] font-semibold text-fg tabular-nums">{`${month}/${day} 週${weekdayName(isoWeekdayOf(data.today))}`}</b>
      </p>
    </section>
  )
}
