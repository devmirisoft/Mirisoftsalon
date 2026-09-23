import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Alert, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import { salonApi } from "@/services/salonApi";

// An appointment is billed on the job cart bill page, not a second one of its
// own. That page bills whatever sits on the appointment's DRAFT invoice, and a
// completed appointment has none until now, so seed it and hand over.
const AppointmentBill = () => {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    salonApi.invoices
      .fromAppointment(appointmentId, { status: "DRAFT" })
      .then(() => setReady(true))
      .catch((seedError) => {
        // Already billed, or parked as a draft earlier: that invoice is the
        // one to open. Anything else is a real failure worth showing.
        if (/already exists/i.test(seedError.message)) setReady(true);
        else setError(seedError.message);
      });
  }, [appointmentId]);

  if (ready) {
    return <Navigate to={`/job-carts/${appointmentId}?bill=1`} replace />;
  }

  return (
    <PageShell
      title="Make Bill"
      description="Opening the bill for this appointment."
      tools={
        <Button color="light" outline onClick={() => navigate("/appointments")}>
          <Icon name="arrow-left" /> Back
        </Button>
      }
    >
      {error ? (
        <Alert color="danger">{error}</Alert>
      ) : (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      )}
    </PageShell>
  );
};

export default AppointmentBill;
