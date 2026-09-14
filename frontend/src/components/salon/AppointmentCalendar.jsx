/* eslint-disable react/prop-types */
import { useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import bootstrapPlugin from "@fullcalendar/bootstrap5";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Icon } from "@/components/Component";
import AppointmentStatusBadge, {
  appointmentStatusClass,
} from "@/components/salon/AppointmentStatusBadge";

const STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const TIME_FORMAT = {
  hour: "numeric",
  minute: "2-digit",
  meridiem: "lowercase",
};

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const AppointmentCalendar = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
  onViewChange,
}) => {
  const calendarRef = useRef(null);

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
      <div className="card-inner appointment-calendar">
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
          initialView="dayGridMonth"
          headerToolbar={{
            left: "todayDay prev,next title",
            center: "",
            right:
              "dayGridMonth,timeGridWeek,timeGridDay,listWeek pageCalendar,pageStaff,pageList",
          }}
          // "Today" is the day view pinned to the current date, so the today
          // and day screens are the same UI.
          customButtons={{
            todayDay: {
              text: "Today",
              click: () => {
                const api = calendarRef.current?.getApi();
                if (!api) return;
                api.changeView("timeGridDay", new Date());
              },
            },
            // page-level view switcher; icons come from CSS since FullCalendar
            // buttons take plain text only
            pageCalendar: { text: "Calendar", click: () => {} },
            pageStaff: { text: "Staff", click: () => onViewChange?.("staff") },
            pageList: { text: "List", click: () => onViewChange?.("list") },
          }}
          buttonText={{
            month: "Month",
            week: "Week",
            day: "Day",
            list: "List",
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
          height={800}
          contentHeight={780}
          aspectRatio={3}
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
          dateClick={(info) => {
            const selectedDate = new Date(info.date);
            const selectedDay = new Date(selectedDate);
            selectedDay.setHours(0, 0, 0, 0);

            if (selectedDay < startOfToday()) return;
            onDateSelect?.(info);
          }}
          dayCellClassNames={(info) => {
            const cellDate = new Date(info.date);
            cellDate.setHours(0, 0, 0, 0);
            return cellDate < startOfToday()
              ? ["appointment-calendar-past-day"]
              : ["appointment-calendar-bookable-day"];
          }}
          eventContent={(arg) => (
            <div className="appt-ev">
              <span className="appt-ev-dot" />
              <div className="appt-ev-body">
                <span className="appt-ev-time">{arg.timeText}</span>
                <span className="appt-ev-title">{arg.event.title}</span>
                {arg.event.extendedProps.services && (
                  <span className="appt-ev-service">
                    {arg.event.extendedProps.services}
                  </span>
                )}
              </div>
              <span className="appt-ev-staff">
                <Icon name="user-alt" />
                {arg.event.extendedProps.staff}
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
        <div className="appt-legend">
          {STATUSES.map((status) => (
            <AppointmentStatusBadge key={status} value={status} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default AppointmentCalendar;
