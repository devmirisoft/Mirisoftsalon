import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Card, Col, Row } from "reactstrap";
import { Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

// SUPER_ADMIN has no salonId, so the salon-scoped endpoints below either 400 or
// return every tenant's rows for it. It gets the platform-wide pair instead.
const endpointAccess = {
  salons: ["SUPER_ADMIN"],
  branches: ["SALON_ADMIN", "RECEPTIONIST"],
  staff: ["SALON_ADMIN", "RECEPTIONIST"],
  customers: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  services: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  appointments: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  invoices: ["SALON_ADMIN", "STAFF"],
  payments: ["SALON_ADMIN", "STAFF"],
  support: ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"],
};

const statMeta = {
  salons: { label: "Salons", icon: "building", color: "info" },
  branches: { label: "Branches", icon: "building", color: "info" },
  staff: { label: "Staff", icon: "users", color: "primary" },
  customers: { label: "Customers", icon: "user-list", color: "success" },
  services: { label: "Services", icon: "scissors", color: "warning" },
  appointments: { label: "Appointments", icon: "calender-date", color: "purple" },
  invoices: { label: "Invoices", icon: "file-docs", color: "danger" },
  payments: { label: "Payments", icon: "tranx", color: "teal" },
  support: { label: "Support tickets", icon: "help", color: "orange" },
};

const Homepage = () => {
  const { user } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: "",
    data: {},
    loadedAt: 0,
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const calls = {
        salons: () => salonApi.salons.list(),
        branches: () => salonApi.branches.list(),
        staff: () => salonApi.staff.list(),
        customers: () => salonApi.customers.list(),
        services: () => salonApi.services.list(),
        appointments: () => salonApi.appointments.list(),
        invoices: () => salonApi.invoices.list(),
        payments: () => salonApi.payments.list(),
        support: () =>
          user?.role === "SUPER_ADMIN"
            ? salonApi.support.list()
            : salonApi.support.mine(),
      };
      const allowed = Object.entries(calls).filter(([key]) =>
        endpointAccess[key].includes(user?.role)
      );
      const results = await Promise.allSettled(allowed.map(([, call]) => call()));
      const data = {};
      results.forEach((result, index) => {
        const key = allowed[index][0];
        data[key] =
          result.status === "fulfilled" && Array.isArray(result.value.data)
            ? result.value.data
            : [];
      });
      if (active) {
        setState({
          loading: false,
          error: "",
          data,
          loadedAt: Date.now(),
        });
      }
    };
    load().catch((error) => {
      if (active) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load dashboard.",
          data: {},
          loadedAt: Date.now(),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [user?.role]);

  const appointments = state.data.appointments || [];
  const invoices = state.data.invoices || [];
  const payments = state.data.payments || [];
  const referenceTime = state.loadedAt || 0;
  const today = new Date(referenceTime).toDateString();
  const todayAppointments = appointments.filter(
    (item) =>
      new Date(item.startTime).toDateString() === today &&
      !["CANCELLED", "NO_SHOW"].includes(item.status)
  );
  const upcomingAppointments = appointments
    .filter(
      (item) =>
        new Date(item.startTime).getTime() >= referenceTime &&
        !["CANCELLED", "NO_SHOW"].includes(item.status)
    )
    .sort(
      (left, right) =>
        new Date(left.startTime).getTime() -
        new Date(right.startTime).getTime()
    );
  const outstanding = invoices
    .filter((invoice) => invoice.status !== "CANCELLED")
    .reduce((total, invoice) => total + Number(invoice.balanceAmount || 0), 0);
  const received = payments.reduce(
    (total, payment) => total + Number(payment.amount || 0),
    0
  );
  const hasOperationalAccess = endpointAccess.customers.includes(user?.role);

  return (
    <PageShell
      title={`Welcome, ${user?.name || "Salon user"}`}
      description={`${labelize(user?.role)} workspace · Live data from backend port 5000`}
    >
      {state.error && <Alert color="danger">{state.error}</Alert>}
      {state.loading ? (
        <div className="text-center py-5">
          <LoaderOne label="Building your live salon overview" />
          <p className="text-soft mt-2">Building your live salon overview...</p>
        </div>
      ) : (
        <>
          <Row className="g-gs"> 
            {Object.entries(state.data).map(([key, rows]) => {
              const meta = statMeta[key];
              return (
                <Col sm="6" xl="3" key={key}>
                  <Card className="card-bordered h-100">
                    <div className="card-inner">
                      <div className="d-flex align-items-center gap-3">
                        <div className={`user-avatar bg-${meta.color}-dim text-${meta.color}`}>
                          <Icon name={meta.icon} />
                        </div>
                        <div>
                          <div className="fs-2 fw-bold">{rows.length}</div>
                          <div className="text-soft">{meta.label}</div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {(invoices.length > 0 || payments.length > 0) && (
            <Row className="g-gs mt-1">
              <Col md="4">
                <Card className="card-bordered h-100">
                  <div className="card-inner">
                    <div className="overline-title text-soft">Today’s bookings</div>
                    <div className="fs-2 fw-bold mt-1">{todayAppointments.length}</div>
                  </div>
                </Card>
              </Col>
              <Col md="4">
                <Card className="card-bordered h-100">
                  <div className="card-inner">
                    <div className="overline-title text-soft">Total received</div>
                    <div className="fs-2 fw-bold text-success mt-1">
                      {formatMoney(received)}
                    </div>
                  </div>
                </Card>
              </Col>
              <Col md="4">
                <Card className="card-bordered h-100">
                  <div className="card-inner">
                    <div className="overline-title text-soft">Outstanding</div>
                    <div className="fs-2 fw-bold text-danger mt-1">
                      {formatMoney(outstanding)}
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>
          )}

          <Row className="g-gs mt-1">
            <Col lg="8">
              <Card className="card-bordered h-100">
                <div className="card-inner">
                  <div className="d-flex justify-content-between mb-3">
                    <h5 className="title mb-0">Upcoming appointments</h5>
                    <Link to="/appointments">View all</Link>
                  </div>
                  <div className="table-responsive">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Customer</th>
                          <th>Staff</th>
                          <th>Schedule</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingAppointments.slice(0, 6).map((appointment) => (
                          <tr key={appointment.id}>
                            <td>{appointment.appointmentCode}</td>
                            <td>{appointment.customer?.name}</td>
                            <td>{appointment.staff?.name}</td>
                            <td>{formatDate(appointment.startTime, true)}</td>
                            <td><StatusBadge value={appointment.status} /></td>
                          </tr>
                        ))}
                        {upcomingAppointments.length === 0 && (
                          <tr>
                            <td colSpan="5" className="text-center text-soft py-4">
                              No upcoming appointments.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            </Col>
            <Col lg="4">
              <Card className="card-bordered h-100">
                <div className="card-inner">
                  <h5 className="title">Quick actions</h5>
                  {hasOperationalAccess ? (
                    <div className="list-group list-group-flush mt-2">
                      <Link className="list-group-item px-0" to="/appointments">
                        <Icon name="calender-date" className="me-2" /> Book appointment
                      </Link>
                      <Link className="list-group-item px-0" to="/customers">
                        <Icon name="user-add" className="me-2" /> Add customer
                      </Link>
                      {endpointAccess.invoices.includes(user?.role) && (
                        <Link className="list-group-item px-0" to="/billing">
                          <Icon name="file-docs" className="me-2" /> Billing & payments
                        </Link>
                      )}
                      <Link className="list-group-item px-0" to="/support">
                        <Icon name="help" className="me-2" /> Raise support ticket
                      </Link>
                    </div>
                  ) : (
                    <Alert color="warning" className="mb-0 mt-3">
                      The backend defines this role but does not currently grant it
                      access to operational API routes.
                    </Alert>
                  )}
                </div>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </PageShell>
  );
};

export default Homepage;
