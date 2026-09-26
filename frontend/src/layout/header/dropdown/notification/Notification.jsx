/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownToggle,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  UncontrolledDropdown,
} from "reactstrap";

import Icon from "@/components/icon/Icon";
import { salonApi } from "@/services/salonApi";

const LATE_STATUSES = new Set(["SCHEDULED", "CONFIRMED"]);
const LATE_AFTER_MS = 60 * 60 * 1000;
const READ_ALERTS_KEY = "salon.notifications.readLateAppointments";

const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

const toLocalInput = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;
};

const formatTime = (date) =>
  new Date(date).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const appointmentName = (appointment) =>
  appointment.customer?.name || appointment.customerName || "Customer";

const appointmentPhone = (appointment) =>
  appointment.customer?.phone || appointment.customerPhone || "No phone";

const alertKey = (appointment) => `${appointment.id}:${appointment.startTime}`;

const readStoredAlerts = () => {
  try {
    const value = JSON.parse(localStorage.getItem(READ_ALERTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const Notification = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [rescheduleAppointment, setRescheduleAppointment] = useState(null);
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [readAlertKeys, setReadAlertKeys] = useState(readStoredAlerts);

  const load = useCallback(async () => {
    const today = toISODate(new Date());
    setError("");
    try {
      const response = await salonApi.appointments.list({ from: today, to: today });
      setAppointments(response.data || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      setNow(Date.now());
      load();
    }, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load]);

  const lateAppointments = useMemo(() => {
    return appointments
      .filter((appointment) => {
        const start = new Date(appointment.startTime).getTime();
        return (
          LATE_STATUSES.has(appointment.status) &&
          Number.isFinite(start) &&
          now - start >= LATE_AFTER_MS
        );
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }, [appointments, now]);

  const unreadLateAppointments = useMemo(
    () =>
      lateAppointments.filter(
        (appointment) => !readAlertKeys.includes(alertKey(appointment))
      ),
    [lateAppointments, readAlertKeys]
  );

  const markAllAsRead = () => {
    const next = Array.from(
      new Set([...readAlertKeys, ...lateAppointments.map(alertKey)])
    );
    setReadAlertKeys(next);
    localStorage.setItem(READ_ALERTS_KEY, JSON.stringify(next));
  };

  const refreshAppointmentsPage = () => {
    window.dispatchEvent(new CustomEvent("appointments:refresh"));
  };

  const cancelAppointment = async (appointment) => {
    setBusyId(appointment.id);
    setError("");
    try {
      await salonApi.appointments.setStatus(appointment.id, {
        status: "CANCELLED",
        note: "Cancelled from late arrival notification.",
      });
      await load();
      refreshAppointmentsPage();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  };

  const startReschedule = (appointment) => {
    const next = new Date();
    next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
    setRescheduleAppointment(appointment);
    setRescheduleTime(toLocalInput(next));
  };

  const submitReschedule = async () => {
    const next = new Date(rescheduleTime);
    if (Number.isNaN(next.getTime())) {
      setError("Choose a valid reschedule time.");
      return;
    }
    if (!rescheduleAppointment) return;

    setBusyId(rescheduleAppointment.id);
    setError("");
    try {
      await salonApi.appointments.reschedule(
        rescheduleAppointment.id,
        next.toISOString()
      );
      setRescheduleAppointment(null);
      setRescheduleTime("");
      await load();
      refreshAppointmentsPage();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <UncontrolledDropdown className="user-dropdown">
        <DropdownToggle tag="a" className="dropdown-toggle nk-quick-nav-icon">
        <div
          className={`icon-status ${
            unreadLateAppointments.length ? "icon-status-info" : ""
          }`}
        >
          <Icon name="bell" />
        </div>
        </DropdownToggle>
        <DropdownMenu end className="dropdown-menu-xl dropdown-menu-s1 appt-notification-menu">
        <div className="appt-notification-head">
          <div className="appt-notification-title">
            <span className="appt-notification-bell">
              <Icon name="bell" />
            </span>
            <span>Notifications</span>
          </div>
          <div className="appt-notification-tools">
            <button
              type="button"
              className="appt-notification-read"
              disabled={!unreadLateAppointments.length}
              onClick={markAllAsRead}
            >
              Mark all as read
            </button>
            <button type="button" className="appt-notification-refresh" onClick={load}>
              <Icon name="reload" />
              Refresh
            </button>
          </div>
        </div>
        <div className="dropdown-body appt-notification-body">
          <div className="nk-notification appt-late-notifications">
            {loading ? (
              <div className="text-center py-4">
                <Spinner color="primary" size="sm" />
              </div>
            ) : error ? (
              <div className="px-3 py-3 text-danger small">{error}</div>
            ) : lateAppointments.length ? (
              lateAppointments.map((appointment) => (
                <div className="appt-late-card" key={appointment.id}>
                  <div className="appt-late-avatar">
                    <Icon name="user-fill" />
                  </div>
                  <div className="appt-late-main">
                    <div className="appt-late-topline">
                      <div>
                        <h6>{appointmentName(appointment)}</h6>
                        <div className="appt-late-missed">
                          Missed {formatTime(appointment.startTime)}
                        </div>
                      </div>
                      <strong className="appt-late-phone">
                        {appointmentPhone(appointment)}
                      </strong>
                    </div>
                    <div className="appt-late-actions">
                      <Button
                        size="sm"
                        className="appt-late-btn appt-late-btn-primary"
                        disabled={busyId === appointment.id}
                        onClick={() => startReschedule(appointment)}
                      >
                        <Icon name="calender-date" />
                        Reschedule
                      </Button>
                      <Button
                        size="sm"
                        className="appt-late-btn appt-late-btn-danger"
                        disabled={busyId === appointment.id}
                        onClick={() => cancelAppointment(appointment)}
                      >
                        <Icon name="cross" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-soft">
                No late appointment alerts.
              </div>
            )}
          </div>
        </div>
        </DropdownMenu>
      </UncontrolledDropdown>
      <Modal
        isOpen={Boolean(rescheduleAppointment)}
        toggle={() => setRescheduleAppointment(null)}
        centered
      >
        <ModalHeader toggle={() => setRescheduleAppointment(null)}>
          Reschedule {appointmentName(rescheduleAppointment || {})}
        </ModalHeader>
        <ModalBody>
          <label className="form-label" htmlFor="late-reschedule-time">
            New appointment time
          </label>
          <Input
            id="late-reschedule-time"
            type="datetime-local"
            value={rescheduleTime}
            onChange={(event) => setRescheduleTime(event.target.value)}
          />
        </ModalBody>
        <ModalFooter>
          <Button color="light" onClick={() => setRescheduleAppointment(null)}>
            Cancel
          </Button>
          <Button
            color="primary"
            disabled={busyId === rescheduleAppointment?.id}
            onClick={submitReschedule}
          >
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default Notification;
