/* eslint-disable react/prop-types */
import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import bootstrapPlugin from "@fullcalendar/bootstrap5";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";

const statusClasses = {
  SCHEDULED: "fc-event-primary",
  CONFIRMED: "fc-event-info",
  CHECKED_IN: "fc-event-warning",
  COMPLETED: "fc-event-success",
  CANCELLED: "fc-event-danger-dim",
  NO_SHOW: "fc-event-danger",
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
}) => {
  const events = useMemo(
    () =>
      appointments.map((appointment) => ({
        id: appointment.id,
        title: `${appointment.customer?.name || "Customer"} · ${
          appointment.staff?.name || "Unassigned"
        }`,
        start: appointment.startTime,
        end: appointment.endTime,
        classNames: [statusClasses[appointment.status] || "fc-event-primary"],
        extendedProps: {
          appointmentCode: appointment.appointmentCode,
          status: appointment.status,
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
            left: "title prev,next",
            center: "",
            right: "today dayGridMonth,timeGridWeek,timeGridDay,listWeek",
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
              props.branch,
              props.status,
            ]
              .filter(Boolean)
              .join(" · ");
          }}
        />
      </div>
    </div>
  );
};

export default AppointmentCalendar;
