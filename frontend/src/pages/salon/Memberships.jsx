import ResourcePanel from "@/components/salon/ResourcePanel";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";
import { Button } from "@/components/Component";
import { useAuth } from "@/auth/AuthContext";

const rupees = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));

// "₹12,000 wallet for ₹10,000"
const describe = ({ walletCreditAmount, price }) => {
  const wallet = Number(walletCreditAmount) > 0 ? `${rupees(walletCreditAmount)} wallet` : "";
  const cost = Number(price) > 0 ? rupees(price) : "";
  return wallet && cost ? `${wallet} for ${cost}` : wallet || (cost && `For ${cost}`);
};

const Memberships = () => {
 const { user } = useAuth(); const manage = ["SUPER_ADMIN","SALON_ADMIN"].includes(user?.role);
 return (
  <PageShell title="Memberships" description="Create membership tiers: set how long they last, what they cost, and the wallet credit customers receive.">
    <ResourcePanel
      title="Memberships"
      api={salonApi.memberships}
      canCreate={manage} canEdit={manage} canDelete={manage}
      renderActions={manage ? (row, reload) => <Button size="sm" color={row.status ? "warning" : "success"} outline onClick={async () => { await salonApi.memberships.setStatus(row.id, !row.status); await reload(); }}>{row.status ? "Deactivate" : "Activate"}</Button> : undefined}
      columns={[
        { key: "name", label: "Membership" },
        { key: "description", label: "Description" },
        { key: "durationMonths", label: "Validity", render: (v) => (v ? `${v} month${v > 1 ? "s" : ""}` : "No expiry") },
        { key: "price", label: "Price", render: formatMoney },
        { key: "walletCreditAmount", label: "Wallet credit", render: formatMoney },
        { key: "_count", label: "Active customers", render: (v) => (v?.customerMemberships || 0) + (v?.customers || 0) },
        { key: "status", label: "Status", render: (v) => <StatusBadge value={v ? "ACTIVE" : "INACTIVE"} /> },
        { key: "createdAt", label: "Created", render: formatDate },
      ]}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "durationMonths", label: "Validity (months)", type: "number", min: 1, max: 600, step: "1", nullable: true, help: "Leave blank for a membership that never expires." },
        { name: "price", label: "Price", type: "number", min: 0, step: "0.01", help: "What the customer pays to buy this membership." },
        { name: "walletCreditAmount", label: "Wallet credit", type: "number", min: 0, step: "0.01", help: "Amount loaded into the membership wallet on purchase. Can exceed the price." },
        { name: "description", label: "Description", type: "textarea", fullWidth: true, nullable: true, disabled: true, derive: describe, help: "Written from the wallet credit and price." },
      ]}
    />
  </PageShell>
 );};
export default Memberships;
