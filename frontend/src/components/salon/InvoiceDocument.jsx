/* eslint-disable react/prop-types */
import { Icon } from "@/components/Component";
import StatusBadge from "@/components/salon/StatusBadge";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

const MirisoftLogo = "/mirisoftlogo.png";

const InvoiceDocument = ({ invoice, printable = false }) => (
  <div className={`invoice ${printable ? "invoice-print" : ""}`}>
    <div className="invoice-wrap">
      <div className="invoice-brand text-center">
        <img src={MirisoftLogo} alt={invoice.salonName || "MiriSoft"} />
        <h4 className="title mt-2 mb-1">{invoice.salonName}</h4>
        {invoice.gstEnabledSnapshot && (
          <div className="text-soft">
            {[
              invoice.gstLegalNameSnapshot,
              invoice.gstNumberSnapshot,
              invoice.gstStateCodeSnapshot
                ? `State ${invoice.gstStateCodeSnapshot}`
                : null,
            ]
              .filter(Boolean)
              .join(" | ")}
          </div>
        )}
        <div className="text-soft">
          {[invoice.salonAddress, invoice.salonPhone, invoice.salonEmail]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>

      <div className="invoice-head">
        <div className="invoice-contact">
          <span className="overline-title">Invoice To</span>
          <div className="invoice-contact-info">
            <h4 className="title">{invoice.customerName}</h4>
            <ul className="list-plain">
              {invoice.customerAddress && (
                <li>
                  <Icon name="map-pin-fill" />
                  <span>{invoice.customerAddress}</span>
                </li>
              )}
              {invoice.customerPhone && (
                <li>
                  <Icon name="call-fill" />
                  <span>{invoice.customerPhone}</span>
                </li>
              )}
              {invoice.customerEmail && (
                <li>
                  <Icon name="mail-fill" />
                  <span>{invoice.customerEmail}</span>
                </li>
              )}
              {invoice.customerGst && (
                <li>
                  <Icon name="file-text" />
                  <span>GST: {invoice.customerGst}</span>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="invoice-desc">
          <h3 className="title">Invoice</h3>
          <ul className="list-plain">
            <li className="invoice-id">
              <span>Invoice ID</span>: <span>{invoice.invoiceCode}</span>
            </li>
            <li className="invoice-date">
              <span>Date</span>: <span>{formatDate(invoice.invoiceDate)}</span>
            </li>
            <li>
              <span>Type</span>: <span>{labelize(invoice.invoiceType)}</span>
            </li>
            <li className="mt-1">
              <StatusBadge value={invoice.status} />{" "}
              <StatusBadge value={invoice.paymentStatus} />
            </li>
          </ul>
        </div>
      </div>

      <div className="invoice-bills">
        <div className="table-responsive">
          <table className="table table-striped">
            <thead>
              <tr>
                <th className="w-150px">Item ID</th>
                <th className="w-60">Description</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Taxable</th>
                <th>GST</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.items || []).map((item) => (
                <tr key={item.id}>
                  <td>{item.itemCode || item.serviceId?.slice(0, 8) || "—"}</td>
                  <td>
                    <strong>{item.serviceName}</strong>
                    {item.description && item.description !== item.serviceName && (
                      <div className="text-soft small">{item.description}</div>
                    )}
                  </td>
                  <td>{formatMoney(item.unitPrice)}</td>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.taxableAmount ?? item.unitPrice)}</td>
                  <td>
                    {Number(item.gstRateSnapshot ?? item.taxPercent ?? 0)}%
                    <div className="text-soft small">
                      {formatMoney(item.gstAmount ?? item.taxAmount)}
                    </div>
                  </td>
                  <td>{formatMoney(item.totalWithTax ?? item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Subtotal</td>
                <td>{formatMoney(invoice.subtotalAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Discount</td>
                <td>- {formatMoney(invoice.discountAmount)}</td>
              </tr>
              {Number(invoice.couponDiscountAmount || 0) > 0 && (
                <tr>
                  <td colSpan="4" />
                  <td colSpan="2">
                    Coupon {invoice.couponCodeSnapshot
                      ? `(${invoice.couponCodeSnapshot})`
                      : ""}
                  </td>
                  <td>- {formatMoney(invoice.couponDiscountAmount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Service taxable amount</td>
                <td>{formatMoney(invoice.serviceTaxableAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Service GST</td>
                <td>{formatMoney(invoice.serviceGstAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Product taxable amount</td>
                <td>{formatMoney(invoice.productTaxableAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Product GST</td>
                <td>{formatMoney(invoice.productGstAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Processing fee</td>
                <td>{formatMoney(invoice.processingFeeAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Total GST</td>
                <td>{formatMoney(invoice.totalGstAmount ?? invoice.taxAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">
                  <strong>Grand Total</strong>
                </td>
                <td>
                  <strong>{formatMoney(invoice.totalAmount)}</strong>
                </td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Paid</td>
                <td className="text-success">{formatMoney(invoice.paidAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Balance</td>
                <td className="text-danger">{formatMoney(invoice.balanceAmount)}</td>
              </tr>
              <tr>
                <td colSpan="4" />
                <td colSpan="2">Payment method</td>
                <td>
                  {[
                    ...new Set(
                      (invoice.payments || []).map((payment) =>
                        labelize(payment.method)
                      )
                    ),
                  ].join(", ") || "—"}
                </td>
              </tr>
            </tfoot>
          </table>
          {invoice.billingNote && (
            <div className="alert alert-light mb-2">
              <strong>Billing note:</strong> {invoice.billingNote}
            </div>
          )}
          <div className="nk-notes ff-italic fs-12px text-soft">
            {invoice.footerNote ||
              "This invoice was created electronically and is valid without a signature or seal."}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default InvoiceDocument;
