import ResourcePanel from "@/components/salon/ResourcePanel";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";
import { Button } from "@/components/Component";
import { useAuth } from "@/auth/AuthContext";

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
        { key: "discountPercentage", label: "Discount", render: (v) => `${Number(v)}%` },
        { key: "durationMonths", label: "Validity", render: (v) => (v ? `${v} month${v > 1 ? "s" : ""}` : "No expiry") },
        { key: "price", label: "Price", render: formatMoney },
        { key: "walletCreditAmount", label: "Wallet credit", render: formatMoney },
        { key: "_count", label: "Active customers", render: (v) => (v?.customerMemberships || 0) + (v?.customers || 0) },
        { key: "status", label: "Status", render: (v) => <StatusBadge value={v ? "ACTIVE" : "INACTIVE"} /> },
        { key: "createdAt", label: "Created", render: formatDate },
      ]}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "discountPercentage", label: "Discount percentage", type: "number", min: 0, max: 100, step: "0.01", required: true },
        { name: "durationMonths", label: "Validity (months)", type: "number", min: 1, max: 600, step: "1", nullable: true, help: "Leave blank for a membership that never expires." },
        { name: "price", label: "Price", type: "number", min: 0, step: "0.01", help: "What the customer pays to buy this membership." },
        { name: "walletCreditAmount", label: "Wallet credit", type: "number", min: 0, step: "0.01", help: "Amount loaded into the membership wallet on purchase. Can exceed the price." },
        { name: "description", label: "Description", type: "textarea", fullWidth: true, nullable: true },
      ]}
    />
  </PageShell>
 );};
export default Memberships;
