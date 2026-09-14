/* eslint-disable react/prop-types */
import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import bootstrapPlugin from "@fullcalendar/bootstrap5";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
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

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const AppointmentCalendar = ({
  appointments,
  onAppointmentClick,
  onDateSelect,
}) => {
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
            left: "today prev,next title",
            center: "",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "Today",
            month: "Month",
            week: "Week",
            day: "Day",
            list: "List",
          }}
          themeSystem="bootstrap5"
          height={800}
          contentHeight={780}
          aspectRatio={3}
          nowIndicator
          allDaySlot={false}
          dayMaxEvents={3}
          slotMinTime="07:00:00"
          slotMaxTime="23:00:00"
          slotDuration="00:30:00"
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
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          eventContent={(arg) => (
            <div className="appt-ev">
              <span className="appt-ev-dot" />
              <div className="appt-ev-body">
                <span className="appt-ev-time">{arg.timeText}</span>
                <span className="appt-ev-title">{arg.event.title}</span>
                <span className="appt-ev-staff">
                  {arg.event.extendedProps.staff}
                </span>
              </div>
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
