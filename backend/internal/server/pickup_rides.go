package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// Pickup-point rides for drivers and passengers (Phase 2, REQ-056, DD-37, DD-38, DD-40, DD-41).

// The commute window in minutes after midnight, Taipei time: slots start 07:00-09:45 (REQ-056).
const (
	commuteWindowStart = 7 * 60
	commuteWindowEnd   = 10 * 60
	commuteSlotMinutes = 15
)

type rideSlot struct {
	SlotStart time.Time       `json:"slot_start"`
	RideCount int64           `json:"ride_count"`
	Weather   json.RawMessage `json:"weather"`   // from traffic_observations (DD-37); null when not observed yet
	Simulated bool            `json:"simulated"` // the cell holds simulated statistics (REQ-063)
}

type rideDay struct {
	Date    string     `json:"date"`
	Weekday int        `json:"weekday"` // ISO: 1 Monday .. 5 Friday
	Slots   []rideSlot `json:"slots"`
}

type rideSummary struct {
	From           string   `json:"from"`
	To             string   `json:"to"`
	DailyAvg       float64  `json:"daily_avg"`        // rides in from-to per day over days
	Weekday        int      `json:"weekday"`          // today's ISO weekday
	SameWeekdayAvg *float64 `json:"same_weekday_avg"` // the same over the days on today's weekday; null if none
}

// slotWindow is the summary's from-to, in minutes after midnight, Taipei time.
type slotWindow struct{ from, to int }

func (w slotWindow) holds(t time.Time) bool {
	m := t.In(taipei).Hour()*60 + t.In(taipei).Minute()
	return m >= w.from && m < w.to
}

// parseSlotTime reads "HH:MM" on a 15-minute boundary within the commute window.
func parseSlotTime(s string) (int, bool) {
	t, err := time.Parse("15:04", s)
	if err != nil || len(s) != 5 {
		return 0, false
	}
	m := t.Hour()*60 + t.Minute()
	return m, m%commuteSlotMinutes == 0 && m >= commuteWindowStart && m <= commuteWindowEnd
}

func parseSlotWindow(from, to string) (slotWindow, bool) {
	f, okF := parseSlotTime(from)
	t, okT := parseSlotTime(to)
	return slotWindow{f, t}, okF && okT && f < t
}

// getPickupRides returns one pickup point's rides per commute slot (REQ-056): days is the past 10
// workdays before today (DD-41), newest first; today runs from 07:00 through the slot holding now
// and adds today's real rides (DD-40 step 4). The summary averages days only, today left out. No
// driver or passenger counts: drivers and passengers see rides only (DD-37).
func (s *Server) getPickupRides(c *gin.Context) {
	pickupID, err := strconv.ParseInt(c.Query("pickup_point_id"), 10, 64)
	if err != nil {
		apiError(c, http.StatusBadRequest, "invalid_request", "需要 pickup_point_id")
		return
	}
	win, ok := parseSlotWindow(c.Query("from"), c.Query("to"))
	if !ok {
		apiError(c, http.StatusBadRequest, "invalid_request",
			"from、to 須為 07:00～10:00 之間以 15 分鐘為單位的時間（HH:MM），且 from 早於 to")
		return
	}
	var exists bool
	if err := s.db.QueryRow(c, `SELECT EXISTS (SELECT 1 FROM pickup_points WHERE id = $1)`, pickupID).Scan(&exists); err != nil {
		s.internalError(c, err)
		return
	}
	if !exists {
		apiError(c, http.StatusNotFound, "not_found", "找不到上車點")
		return
	}
	realNow := s.now()
	m, err := commuteNow(c, s.db, realNow)
	if err != nil {
		s.internalError(c, err)
		return
	}
	days, err := s.pastRideDays(c, pickupID, m)
	if err != nil {
		s.internalError(c, err)
		return
	}
	today, err := s.todayRides(c, pickupID, m, realNow)
	if err != nil {
		s.internalError(c, err)
		return
	}
	simulated := anySimulated(today)
	for _, d := range days {
		simulated = simulated || anySimulated(d)
	}
	c.JSON(http.StatusOK, gin.H{
		"now":             m.Now,
		"pickup_point_id": pickupID,
		"days":            days,
		"today":           today,
		"summary":         summarizeRides(days, today.Weekday, win, c.Query("from"), c.Query("to")),
		"simulated":       simulated, // REQ-063
	})
}

// slotWeather is the slot's one weather from the traffic table (DD-36, REQ-083).
const slotWeather = `
	LEFT JOIN LATERAL (SELECT o.weather FROM traffic_observations o
	                    WHERE o.slot_start = %s AND o.weather IS NOT NULL ORDER BY o.vd_id LIMIT 1) w ON true`

func (s *Server) pastRideDays(c *gin.Context, pickupID int64, m commuteMoment) ([]rideDay, error) {
	rows, err := s.db.Query(c, `
		SELECT d.day, extract(isodow FROM d.day)::int, st.slot_start, st.ride_count, w.weather, st.simulated
		  FROM commute_past_workdays($1::date, $2) d (day)
		  LEFT JOIN supply_demand_stats st
		         ON st.pickup_point_id = $3
		        AND st.slot_start >= (d.day::timestamp AT TIME ZONE 'Asia/Taipei')
		        AND st.slot_start < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Taipei')`+
		fmt.Sprintf(slotWeather, "st.slot_start")+`
		 ORDER BY d.day DESC, st.slot_start`, m.Today.Format(dateLayout), commutePastWorkdays, pickupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []rideDay{}
	for rows.Next() {
		var day time.Time
		var weekday int
		var slotStart *time.Time
		var rides *int64
		var weather []byte
		var sim *bool
		if err := rows.Scan(&day, &weekday, &slotStart, &rides, &weather, &sim); err != nil {
			return nil, err
		}
		date := day.Format(dateLayout)
		if len(days) == 0 || days[len(days)-1].Date != date {
			days = append(days, rideDay{Date: date, Weekday: weekday, Slots: []rideSlot{}})
		}
		if slotStart == nil { // a workday without statistics
			continue
		}
		last := &days[len(days)-1]
		last.Slots = append(last.Slots, rideSlot{
			SlotStart: slotStart.In(taipei), RideCount: *rides, Weather: nullIfEmpty(weather), Simulated: *sim,
		})
	}
	return days, rows.Err()
}

// todayRides is today's simulated statistics plus today's real rides (commute_real_rides, the
// rule shared with the city dashboard, REQ-083), from 07:00 through the slot holding now.
func (s *Server) todayRides(c *gin.Context, pickupID int64, m commuteMoment, realNow time.Time) (rideDay, error) {
	today := rideDay{Date: m.Today.Format(dateLayout), Weekday: isoWeekday(m.Today), Slots: []rideSlot{}}
	rows, err := s.db.Query(c, `
		WITH g AS (
		    SELECT local AT TIME ZONE 'Asia/Taipei' AS slot_start
		      FROM generate_series($1::date + time '07:00', $1::date + time '09:45', interval '15 minutes') local)
		SELECT g.slot_start, COALESCE(st.ride_count, 0) + COALESCE(r.rides, 0), w.weather, COALESCE(st.simulated, false)
		  FROM g
		  LEFT JOIN supply_demand_stats st ON st.pickup_point_id = $2 AND st.slot_start = g.slot_start
		  LEFT JOIN commute_real_rides($3) r ON r.pickup_point_id = $2 AND r.slot_start = g.slot_start`+
		fmt.Sprintf(slotWeather, "g.slot_start")+`
		 WHERE g.slot_start <= $4
		 ORDER BY g.slot_start`, today.Date, pickupID, realNow, m.Now)
	if err != nil {
		return rideDay{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var sl rideSlot
		var weather []byte
		if err := rows.Scan(&sl.SlotStart, &sl.RideCount, &weather, &sl.Simulated); err != nil {
			return rideDay{}, err
		}
		sl.SlotStart = sl.SlotStart.In(taipei)
		sl.Weather = nullIfEmpty(weather)
		today.Slots = append(today.Slots, sl)
	}
	return today, rows.Err()
}

// summarizeRides averages the rides in the window per day (REQ-056): over all the days, and over
// the days on today's weekday. A day without a slot in the window counts as zero rides.
func summarizeRides(days []rideDay, weekday int, win slotWindow, from, to string) rideSummary {
	var total, sameTotal, sameDays float64
	for _, d := range days {
		var n float64
		for _, sl := range d.Slots {
			if win.holds(sl.SlotStart) {
				n += float64(sl.RideCount)
			}
		}
		total += n
		if d.Weekday == weekday {
			sameTotal += n
			sameDays++
		}
	}
	sum := rideSummary{From: from, To: to, Weekday: weekday}
	if len(days) > 0 {
		sum.DailyAvg = total / float64(len(days))
	}
	if sameDays > 0 {
		avg := sameTotal / sameDays
		sum.SameWeekdayAvg = &avg
	}
	return sum
}

func anySimulated(d rideDay) bool {
	for _, sl := range d.Slots {
		if sl.Simulated {
			return true
		}
	}
	return false
}

// isoWeekday is 1 for Monday .. 7 for Sunday.
func isoWeekday(t time.Time) int {
	if wd := int(t.Weekday()); wd != 0 {
		return wd
	}
	return 7
}
