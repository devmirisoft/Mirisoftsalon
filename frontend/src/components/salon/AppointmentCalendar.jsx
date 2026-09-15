/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import bootstrapPlugin from "@fullcalendar/bootstrap5";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Button, Icon } from "@/components/Component";
import { appointmentStatusClass } from "@/components/salon/AppointmentStatusBadge";
import StaffDayBoard from "@/components/salon/StaffDayBoard";

const VIEWS = [
  { type: "dayGridMonth", label: "Month" },
  { type: "timeGridWeek", label: "Week" },
  { type: "timeGridDay", label: "Day" },
  { type: "listWeek", label: "List" },
  { type: "staff", label: "Staff" },
];

const TIME_FORMAT = {
  hour: "numeric",
  minute: "2-digit",
  meridiem: "lowercase",
};

const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

const AppointmentCalendar = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
  selectedDate,
  onDateChange,
  focusDate,
  staff = [],
  onSlotClick,
}) => {
  const calendarRef = useRef(null);
  // FullCalendar's own toolbar cannot share a row with the card title, so the
  // bar below is ours and these mirror whatever the calendar currently shows.
  const [title, setTitle] = useState("");
  const [view, setView] = useState("dayGridMonth");
  const api = () => calendarRef.current?.getApi();

  // The staff board replaces FullCalendar for one day, so it borrows the same
  // header: prev/next/Today step that day instead of the calendar's range.
  const isStaffView = view === "staff";
  const boardDate = selectedDate ? new Date(`${selectedDate}T00:00`) : new Date();

  const shiftDay = (days) => {
    const next = new Date(boardDate);
    next.setDate(next.getDate() + days);
    onDateChange?.(toISODate(next));
  };

  const changeView = (type) => {
    if (type === "staff") {
      if (!selectedDate) onDateChange?.(toISODate(new Date()));
      setView("staff");
      return;
    }
    // Leaving the board remounts FullCalendar, which reads initialView/Date.
    if (isStaffView) setView(type);
    else api()?.changeView(type);
  };

  // A date filter is useless if the calendar keeps showing the current month.
  useEffect(() => {
    if (focusDate) calendarRef.current?.getApi()?.gotoDate(focusDate);
  }, [focusDate]);

  const events = useMemo(
    () =>
      appointments.map((appointment) => ({
        id: appointment.id,
        title: appointment.customer?.name || "Customer",
        start: appointment.startTime,
        end: appointment.endTime,
        classNames: [appointmentStatusClass(appointment.status)],
        extendedProps: {
          appointmentCode: appointment.appointmentCode,
          status: appointment.status,
          staff: appointment.staff?.name || "Unassigned",
          branch: appointment.branch?.name,
          amount: appointment.estimatedAmount,
          services: appointment.services?.map((item) => item.serviceName).join(", "),
        },
      })),
    [appointments]
  );

  return (
    <div className="card card-bordered">
      <div className="card-inner border-bottom appt-calendar-head">
        <span className="appt-calendar-head-icon">
          <Icon name="calender-date" />
        </span>
        <h5 className="title mb-0">Appointment Calendar</h5>
        <Button
          color="light"
          className="btn-icon"
          aria-label="Previous"
          onClick={() => (isStaffView ? shiftDay(-1) : api()?.prev())}
        >
          <Icon name="chevron-left" />
        </Button>
        <Button
          color="light"
          className="btn-icon"
          aria-label="Next"
          onClick={() => (isStaffView ? shiftDay(1) : api()?.next())}
        >
          <Icon name="chevron-right" />
        </Button>
        <span className="appt-calendar-range">
          {isStaffView
            ? boardDate.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : title}
        </span>
        <div className="appt-calendar-views">
          {/* "Today" is the day view pinned to the current date, so the today
              and day screens are the same UI. */}
          <Button
            color="light"
            onClick={() =>
              isStaffView
                ? onDateChange?.(toISODate(new Date()))
                : api()?.changeView("timeGridDay", new Date())
            }
          >
            Today
          </Button>
          <div className="btn-group">
            {VIEWS.map((item) => (
              <Button
                key={item.type}
                color={view === item.type ? "primary" : "light"}
                onClick={() => changeView(item.type)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="card-inner appointment-calendar">
        {isStaffView ? (
          <StaffDayBoard
            date={boardDate}
            staff={staff}
            appointments={appointments}
            onAppointmentClick={onAppointmentClick}
            onSlotClick={onSlotClick}
          />
        ) : (
          <FullCalendar
            ref={calendarRef}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              bootstrapPlugin,
              interactionPlugin,
            ]}
            events={events}
            initialView={view}
            initialDate={boardDate}
            headerToolbar={false}
            datesSet={(arg) => {
              setTitle(arg.view.title);
              setView(arg.view.type);
            }}
            views={{
              dayGridMonth: {
                titleFormat: { month: "long", year: "numeric" },
                dayHeaderFormat: { weekday: "short" },
              },
              timeGridWeek: {
                titleFormat: { month: "short", day: "numeric", year: "numeric" },
                displayEventEnd: true,
              },
              timeGridDay: {
                titleFormat: {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                },
                displayEventEnd: true,
              },
            }}
            // Week header stacks the weekday over the date, as in the design.
            dayHeaderContent={(arg) =>
              arg.view.type === "timeGridWeek" ? (
                <div className="appt-dayhead">
                  <span className="appt-dayhead-name">
                    {arg.date.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <span className="appt-dayhead-date">
                    {arg.date.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              ) : undefined
            }
            themeSystem="bootstrap5"
            height="auto"
            nowIndicator
            allDaySlot={false}
            dayMaxEvents={3}
            expandRows
            slotMinTime="07:00:00"
            slotMaxTime="23:00:00"
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            slotLabelFormat={TIME_FORMAT}
            eventTimeFormat={TIME_FORMAT}
            dateClick={(info) => onDateSelect?.(info)}
            dayCellClassNames={(info) =>
              toISODate(info.date) === selectedDate
                ? ["appointment-calendar-selected-day"]
                : ["appointment-calendar-bookable-day"]
            }
            eventContent={(arg) => (
              <div className="appt-ev">
                <span className="appt-ev-time">
                  <span className="appt-ev-dot" />
                  {arg.timeText}
                </span>
                <span className="appt-ev-title">{arg.event.title}</span>
                <span className="appt-ev-meta">
                  <span className="appt-ev-service">
                    {arg.event.extendedProps.services}
                  </span>
                  <span className="appt-ev-staff">
                    <Icon name="user-alt" />
                    {arg.event.extendedProps.staff}
                  </span>
                </span>
              </div>
          )}
          eventClick={(info) => {
            const appointment = appointments.find(
              (item) => item.id === info.event.id
            );
            if (appointment) onAppointmentClick(appointment);
          }}
          eventDidMount={(info) => {
            const props = info.event.extendedProps;
            info.el.title = [
              props.appointmentCode,
              props.services,
              props.staff,
              props.branch,
              props.status,
            ]
              .filter(Boolean)
              .join(" · ");
          }}
        />
        )}
      </div>
    </div>
  );
};

export default AppointmentCalendar;
