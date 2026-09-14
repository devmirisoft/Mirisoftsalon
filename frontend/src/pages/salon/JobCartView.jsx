/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Col, Row, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

const num = (value) => Number(value || 0);

const Field = ({ label, children }) => (
  <Col md="3" className="mb-3">
    <div className="text-soft small">{label}</div>
    <div className="fw-medium">{children || "—"}</div>
  </Col>
);

const SummaryRow = ({ label, value, strong }) => (
  <div className="d-flex justify-content-between py-2 border-bottom">
    <span className={strong ? "" : "text-soft"}>{label}</span>
    {strong ? <strong>{value}</strong> : <span>{value}</span>}
  </div>
);

const Section = ({ title, children, right }) => (
  <div className="card card-bordered mb-4">
    <div className="card-inner">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="mb-0">{title}</h6>
        {right}
      </div>
      {children}
    </div>
  </div>
);

const Empty = ({ text }) => <p className="text-soft mb-0">{text}</p>;

// Read-only companion to JobCartDetails: the whole cart on one page — who it is
// for, which branch it belongs to, every line billed, packages redeemed and the
// money taken — with nothing on it that edits the cart.
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

  const invoice = cart?.invoice;
  const items = cart?.items || [];
  const redemptions = cart?.packageRedemptions || [];
  const payments = invoice?.payments || [];

  return (
    <PageShell
      title={cart ? `Job Cart ${cart.jobCartId}` : "Job Cart"}
      inlineDescription
      description={
        cart
          ? `${cart.branch?.name || "No branch"} • ${formatDate(
              cart.startTime,
              true
            )}`
          : "Full job cart content"
      }
      tools={
        <>
          <Button color="light" outline onClick={() => navigate("/job-carts")}>
            <Icon name="arrow-left" /> Back
          </Button>
          <Button color="light" outline onClick={() => window.print()}>
            <Icon name="printer" /> Print
          </Button>
          {cart?.status === "ACTIVE" && (
            <Button
              color="primary"
              outline
              onClick={() => navigate(`/job-carts/${cart.id}`)}
            >
              <Icon name="edit" /> Edit
            </Button>
          )}
          {cart && <StatusBadge value={cart.status} />}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      {loading && !cart ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : cart ? (
        <Row className="g-4">
          <Col lg="8">
            <Section title="Job">
              <Row className="g-2">
                <Field label="Job Cart ID">{cart.jobCartId}</Field>
                <Field label="Branch">{cart.branch?.name}</Field>
                <Field label="Salon">{cart.salon?.name}</Field>
                <Field label="Status">
                  <StatusBadge value={cart.status} />
                </Field>
                <Field label="Customer">
                  {cart.customer ? (
                    <Link to={`/customers/${cart.customer.id}`}>
                      {cart.customer.name}
                    </Link>
                  ) : (
                    "Walk-in"
                  )}
                </Field>
                <Field label="Phone">{cart.customer?.phone}</Field>
                <Field label="Customer Code">
                  {cart.customer?.customerCode}
                </Field>
                <Field label="Membership">
                  {cart.customer?.membership?.name}
                </Field>
                <Field label="Start">{formatDate(cart.startTime, true)}</Field>
                <Field label="End">
                  {cart.endTime ? formatDate(cart.endTime, true) : null}
                </Field>
                <Field label="Duration">
                  {cart.totalDurationMinutes
                    ? `${cart.totalDurationMinutes} min`
                    : null}
                </Field>
                <Field label="Primary Staff">{cart.staff?.name}</Field>
                <Field label="Created By">{cart.createdBy?.name}</Field>
                <Field label="Created At">
                  {formatDate(cart.createdAt, true)}
                </Field>
                <Field label="Last Updated">
                  {formatDate(cart.updatedAt, true)}
                </Field>
                <Field label="Source">
                  {cart.source ? labelize(cart.source) : null}
                </Field>
                <Field label="Booking Note">{cart.bookingNote}</Field>
                <Field label="Internal Note">{cart.internalNote}</Field>
              </Row>
            </Section>

            <Section title={`Items (${items.length})`}>
              {items.length === 0 ? (
                <Empty text="Nothing has been added to this cart." />
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Item</th>
                        <th>Staff</th>
                        <th className="text-end">Qty</th>
                        <th className="text-end">Price</th>
                        <th className="text-end">GST</th>
                        <th className="text-end">Tax</th>
                        <th className="text-end">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={`${item.itemType}-${item.id}`}>
                          <td>{labelize(item.itemType)}</td>
                          <td>{item.serviceName || "—"}</td>
                          <td>
                            {item.staff?.name || item.soldByStaff?.name || "—"}
                          </td>
                          <td className="text-end">{item.quantity ?? 1}</td>
                          <td className="text-end">
                            {formatMoney(item.price)}
                          </td>
                          <td className="text-end">
                            {item.gstPercent != null
                              ? `${num(item.gstPercent)}%`
                              : "—"}
                          </td>
                          <td className="text-end">
                            {item.taxAmount != null
                              ? formatMoney(item.taxAmount)
                              : "—"}
                          </td>
                          <td className="text-end">
                            {item.lineTotal != null
                              ? formatMoney(item.lineTotal)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={`Package Redemptions (${redemptions.length})`}>
              {redemptions.length === 0 ? (
                <Empty text="No package was redeemed on this job." />
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Package</th>
                        <th>Service</th>
                        <th>Staff</th>
                        <th>Valid Until</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.flatMap((usage) =>
                        (usage.items || []).map((line) => (
                          <tr key={line.id}>
                            <td>
                              {usage.customerPackage?.packageNameSnapshot ||
                                "—"}
                            </td>
                            <td>
                              {line.serviceName ||
                                line.customerPackageServiceBalance
                                  ?.serviceNameSnapshot ||
                                "—"}
                            </td>
                            <td>{line.staff?.name || "—"}</td>
                            <td>
                              {formatDate(usage.customerPackage?.validUntil)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={`Payments (${payments.length})`}>
              {payments.length === 0 ? (
                <Empty text="No payment has been recorded." />
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Paid At</th>
                        <th>Method</th>
                        <th>Reference</th>
                        <th>Note</th>
                        <th className="text-end">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatDate(payment.paidAt, true)}</td>
                          <td>{labelize(payment.method || "")}</td>
                          <td>{payment.referenceNo || "—"}</td>
                          <td>{payment.note || "—"}</td>
                          <td className="text-end">
                            {formatMoney(payment.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Col>

          <Col lg="4">
            <Section
              title="Bill"
              right={
                invoice ? <StatusBadge value={invoice.status} /> : undefined
              }
            >
              {invoice ? (
                <>
                  <SummaryRow
                    label="Invoice No"
                    value={invoice.invoiceNumber || "Draft"}
                  />
                  <SummaryRow
                    label="Subtotal"
                    value={formatMoney(invoice.subtotalAmount)}
                  />
                  <SummaryRow
                    label="Discount"
                    value={formatMoney(invoice.discountAmount)}
                  />
                  {num(invoice.membershipDiscountAmount) > 0 && (
                    <SummaryRow
                      label="Membership Discount"
                      value={formatMoney(invoice.membershipDiscountAmount)}
                    />
                  )}
                  {num(invoice.processingFeeAmount) > 0 && (
                    <SummaryRow
                      label="Processing Fee"
                      value={formatMoney(invoice.processingFeeAmount)}
                    />
                  )}
                  <SummaryRow
                    label="Tax"
                    value={formatMoney(invoice.taxAmount)}
                  />
                  {num(invoice.roundOffAmount) !== 0 && (
                    <SummaryRow
                      label="Round Off"
                      value={formatMoney(invoice.roundOffAmount)}
                    />
                  )}
                  <SummaryRow
                    label="Total"
                    value={formatMoney(invoice.totalAmount)}
                    strong
                  />
                  <SummaryRow
                    label="Paid"
                    value={formatMoney(invoice.paidAmount)}
                  />
                  <SummaryRow
                    label="Balance"
                    value={formatMoney(invoice.balanceAmount)}
                    strong
                  />
                  <div className="d-flex justify-content-between pt-3">
                    <span className="text-soft">Payment</span>
                    <StatusBadge value={invoice.paymentStatus} />
                  </div>
                  {invoice.coupon && (
                    <div className="d-flex justify-content-between pt-2">
                      <span className="text-soft">Coupon</span>
                      <span>{invoice.coupon.code}</span>
                    </div>
                  )}
                  {invoice.billingNote && (
                    <p className="text-soft mt-3 mb-0">{invoice.billingNote}</p>
                  )}
                </>
              ) : (
                <Empty text="This cart has no bill yet." />
              )}
            </Section>

            <Section title="Customer Wallet">
              <SummaryRow
                label="Wallet Balance"
                value={formatMoney(cart.customer?.walletBalance)}
              />
              <SummaryRow
                label="Outstanding"
                value={formatMoney(cart.customer?.outstandingAmount)}
              />
              <SummaryRow
                label="Loyalty Points"
                value={num(cart.customer?.loyaltyPoints)}
              />
            </Section>
          </Col>
        </Row>
      ) : (
        !error && <Empty text="Job cart not found." />
      )}
    </PageShell>
  );
};

export default JobCartView;
