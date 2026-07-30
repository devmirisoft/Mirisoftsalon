/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Alert, Input, Spinner } from "reactstrap";
import Content from "@/layout/content/Content";
import Head from "@/layout/head/Head";
import InvoiceDocument from "@/components/salon/InvoiceDocument";
import SchemaModal from "@/components/salon/SchemaModal";
import {
  Block,
  BlockBetween,
  BlockDes,
  BlockHead,
  BlockHeadContent,
  BlockTitle,
  Button,
  Icon,
} from "@/components/Component";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, toLocalInput } from "@/utils/salonFormat";
import { useAuth } from "@/auth/AuthContext";

const InvoiceDetails = () => {
  const { invoiceId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invoice, setInvoice] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    salonApi.invoices
      .get(invoiceId)
      .then((response) => {
        if (active) setInvoice(response.data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invoiceId]);

  useEffect(() => {
    setPaymentOpen(location.pathname.endsWith("/pay"));
  }, [location.pathname]);

  const runInvoiceAction = async (action) => {
    setWorking(true);
    setError("");
    try {
      const response = await action();
      setInvoice(response.data);
      setCouponCode("");
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking(false);
    }
  };

  const canApplyCoupon = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(
    user?.role
  );
  const canIssue = ["SUPER_ADMIN", "SALON_ADMIN"].includes(user?.role);
  const canRecordPayment = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(
    user?.role
  );
  const isSourceCancelled = invoice?.appointment?.status === "CANCELLED";
  const canPay =
    canRecordPayment &&
    invoice?.status === "ISSUED" &&
    invoice?.paymentStatus !== "PAID" &&
    !isSourceCancelled;
  const paymentFields = useMemo(
    () => [
      {
        name: "invoiceId",
        label: "Invoice",
        type: "select",
        required: true,
        fullWidth: true,
        defaultValue: invoice?.id || "",
        options: invoice
          ? [
              {
                value: invoice.id,
                label: `${invoice.invoiceCode} - ${
                  invoice.customerName
                } - Balance ${formatMoney(invoice.balanceAmount)}`,
              },
            ]
          : [],
      },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        min: 0.01,
        step: "0.01",
        required: true,
        defaultValue: invoice?.balanceAmount || "",
      },
      {
        name: "method",
        label: "Payment method",
        type: "select",
        required: true,
        options: ["CASH", "CARD", "UPI", "OTHER"].map((value) => ({
          value,
          label: value,
        })),
      },
      { name: "referenceNo", label: "Reference number" },
      {
        name: "paidAt",
        label: "Paid at",
        type: "datetime-local",
        defaultValue: toLocalInput(new Date()),
      },
      { name: "note", label: "Payment note", type: "textarea", fullWidth: true },
    ],
    [invoice]
  );

  const closePayment = () => {
    setPaymentOpen(false);
    if (location.pathname.endsWith("/pay")) {
      navigate(`/billing/invoices/${invoiceId}`, { replace: true });
    }
  };

  const submitPayment = async (values) => {
    await salonApi.payments.create({
      ...values,
      ...(values.paidAt
        ? { paidAt: new Date(values.paidAt).toISOString() }
        : {}),
    });
    const refreshed = await salonApi.invoices.get(invoiceId);
    setInvoice(refreshed.data);
    closePayment();
  };

  return (
    <>
      <Head title="Invoice details" />
      <Content>
        <BlockHead>
          <BlockBetween className="g-3">
            <BlockHeadContent>
              <BlockTitle>
                Invoice{" "}
                <strong className="text-primary small">
                  #{invoice?.invoiceCode || "Loading"}
                </strong>
              </BlockTitle>
              {invoice && (
                <BlockDes className="text-soft">
                  <p>Created {formatDate(invoice.invoiceDate, true)}</p>
                </BlockDes>
              )}
            </BlockHeadContent>
            <BlockHeadContent>
              <div className="d-flex gap-2">
                <Link to="/billing">
                  <Button color="light" outline>
                    <Icon name="arrow-left" /> Back
                  </Button>
                </Link>
                {canPay && (
                  <Link to={`/billing/invoices/${invoice.id}/pay`}>
                    <Button color="success">
                      <Icon name="wallet-in" /> Pay
                    </Button>
                  </Link>
                )}
                {invoice && (
                  <Link to={`/billing/invoices/${invoice.id}/print`} target="_blank">
                    <Button color="primary">
                      <Icon name="printer-fill" /> Print invoice
                    </Button>
                  </Link>
                )}
              </div>
            </BlockHeadContent>
          </BlockBetween>
        </BlockHead>
        <Block>
          {error && <Alert color="danger">{error}</Alert>}
          {loading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
            </div>
          ) : invoice ? (
            <>
              {invoice.status === "DRAFT" && (
                <div className="card card-bordered mb-4">
                  <div className="card-inner">
                    <div className="d-flex flex-wrap justify-content-between align-items-end gap-3">
                      <div>
                        <h6 className="mb-1">Draft invoice</h6>
                        <p className="text-soft mb-0">
                          Apply or remove a coupon before issuing this invoice.
                        </p>
                      </div>
                      {canIssue && (
                        <Button
                          color="success"
                          disabled={working}
                          onClick={() =>
                            runInvoiceAction(() =>
                              salonApi.invoices.issue(invoice.id)
                            )
                          }
                        >
                          Issue invoice
                        </Button>
                      )}
                    </div>
                    {canApplyCoupon && (
                      <div className="d-flex flex-wrap gap-2 mt-3">
                        <Input
                          value={couponCode}
                          disabled={working || Boolean(invoice.couponId)}
                          placeholder="Coupon code"
                          style={{ maxWidth: 260 }}
                          onChange={(event) =>
                            setCouponCode(event.target.value.toUpperCase())
                          }
                        />
                        {!invoice.couponId ? (
                          <Button
                            color="primary"
                            outline
                            disabled={working || !couponCode.trim()}
                            onClick={() =>
                              runInvoiceAction(() =>
                                salonApi.invoices.applyCoupon(
                                  invoice.id,
                                  couponCode
                                )
                              )
                            }
                          >
                            Apply coupon
                          </Button>
                        ) : (
                          <Button
                            color="danger"
                            outline
                            disabled={working}
                            onClick={() =>
                              runInvoiceAction(() =>
                                salonApi.invoices.removeCoupon(invoice.id)
                              )
                            }
                          >
                            Remove {invoice.couponCodeSnapshot}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <InvoiceDocument invoice={invoice} />
              <SchemaModal
                isOpen={paymentOpen && canPay}
                toggle={closePayment}
                title={`Record payment - ${invoice.invoiceCode}`}
                fields={paymentFields}
                submitLabel="Record payment"
                onSubmit={submitPayment}
              />
            </>
          ) : null}
        </Block>
      </Content>
    </>
  );
};

export default InvoiceDetails;
