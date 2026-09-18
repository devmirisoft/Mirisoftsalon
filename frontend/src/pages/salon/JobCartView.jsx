/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import Head from "@/layout/head/Head";
import Content from "@/layout/content/Content";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate } from "@/utils/salonFormat";

const Field = ({ icon, label, children }) => (
  <div className="jcv-field">
    <span className="jcv-avatar">
      <Icon name={icon} />
    </span>
    <div>
      <span className="jcv-label">{label}</span>
      <strong>{children || "—"}</strong>
    </div>
  </div>
);

const Section = ({ icon, title, children }) => (
  <div className="card jcv-card mb-4">
    <div className="jcv-card-head">
      <span className="jcp-tile">
        <Icon name={icon} />
      </span>
      <h6>{title}</h6>
    </div>
    {children}
  </div>
);

const SlipRow = ({ label, value }) => (
  <div className="jc-slip-row">
    <span>{label}</span>
    <strong>{value || "—"}</strong>
  </div>
);

// Read-only job view: who the job is for, who works it and which services it
// covers. Prices live on the bill, not here. Printing swaps the cards for a
// receipt-width slip.
const JobCartView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.jobCarts.get(id);
      setCart(response.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Package-covered services are work on this job too, so they sit on the slip.
  const lines = cart
    ? [
        ...(cart.items || []).map((item) => ({
          id: item.id,
          name: item.serviceName,
          quantity: item.quantity ?? 1,
          staff: item.staff?.name || item.soldByStaff?.name,
        })),
        ...(cart.packageRedemptions || [])
          .filter((usage) => usage.status !== "CANCELLED")
          .flatMap((usage) =>
            (usage.items || []).map((line) => ({
              id: line.id,
              name: line.serviceNameSnapshot || line.serviceName,
              quantity: line.quantity ?? 1,
              staff: line.staff?.name,
            }))
          ),
      ]
    : [];

  return (
    <>
    <Head title={cart ? `Job Cart ${cart.jobCartId}` : "Job Cart"} />
    <Content className="jcp jcv">
      <div className="jcv-top d-print-none">
        <button
          type="button"
          className="jcv-back"
          onClick={() => navigate("/job-carts")}
        >
          <Icon name="arrow-left" /> Back to Jobs
        </button>
        <div className="d-flex flex-wrap align-items-start gap-3">
          <div>
            <h3 className="jcv-title">
              {cart ? `Job Cart ${cart.jobCartId}` : "Job Cart"}
            </h3>
            {cart && <StatusBadge value={cart.status} />}
          </div>
          <div className="ms-auto d-flex gap-2">
            <Button className="jcv-btn-light" onClick={() => window.print()}>
              <Icon name="printer" /> <span>Print</span>
            </Button>
            {cart?.status === "ACTIVE" && (
              <Button
                className="jcv-btn-dark"
                onClick={() => navigate(`/job-carts/${cart.id}`)}
              >
                <Icon name="edit" /> <span>Edit</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <Alert color="danger">{error}</Alert>}

      {loading && !cart ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : cart ? (
        <>
        <div className="d-print-none">
          <Section icon="file-text" title="Job Details">
            <div className="jcv-fields">
              <Field icon="tag" label="Job Cart ID">
                {cart.jobCartId}
              </Field>
              <Field icon="user" label="Customer">
                {cart.customer ? (
                  <Link to={`/customers/${cart.customer.id}`}>
                    {cart.customer.name}
                  </Link>
                ) : (
                  "Walk-in"
                )}
              </Field>
              <Field icon="call" label="Phone">
                {cart.customer?.phone}
              </Field>
              <Field icon="calendar" label="Created At">
                {formatDate(cart.createdAt, true)}
              </Field>
              <Field icon="user" label="Staff">
                {cart.staff?.name}
              </Field>
            </div>
          </Section>

          <Section icon="scissor" title={`Services (${lines.length})`}>
            {lines.length === 0 ? (
              <p className="text-soft px-3 pb-3 mb-0">
                No services on this job cart.
              </p>
            ) : (
              <div className="table-responsive px-3 pb-2">
                <table className="table jcv-table mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>#</th>
                      <th>Service</th>
                      <th>Staff</th>
                      <th className="text-end">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={line.id}>
                        <td>{index + 1}</td>
                        <td className="fw-bold">{line.name || "—"}</td>
                        <td>
                          {line.staff ? (
                            <span className="d-inline-flex align-items-center gap-2 fw-bold">
                              <span className="jcv-avatar jcv-avatar-sm">
                                <Icon name="user" />
                              </span>
                              {line.staff}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-end">
                          <span className="jcp-chip">{line.quantity}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <div className="jc-slip d-none d-print-block">
          <div className="jc-slip-title">
            <strong>{cart.salon?.name || "Job Slip"}</strong>
            <span>JOB CART #{cart.jobCartId}</span>
          </div>
          <SlipRow label="Customer" value={cart.customer?.name || "Walk-in"} />
          <SlipRow label="Phone" value={cart.customer?.phone} />
          <SlipRow label="Created" value={formatDate(cart.createdAt, true)} />
          <SlipRow label="Staff" value={cart.staff?.name} />
          <div className="jc-slip-sep" />
          <div className="jc-slip-row jc-slip-head">
            <span>Service</span>
            <span>Staff / Qty</span>
          </div>
          {lines.length ? (
            lines.map((line, index) => (
              <div className="jc-slip-row" key={line.id}>
                <span>
                  {index + 1}. {line.name || "—"}
                </span>
                <span>
                  {line.staff || "—"} x{line.quantity}
                </span>
              </div>
            ))
          ) : (
            <div className="jc-slip-row text-soft">No services.</div>
          )}
          <div className="jc-slip-sep" />
          <div className="jc-slip-foot">
            {lines.length} service{lines.length === 1 ? "" : "s"}
          </div>
        </div>
        </>
      ) : (
        !error && <p className="text-soft mb-0">Job cart not found.</p>
      )}
    </Content>
    </>
  );
};

export default JobCartView;
