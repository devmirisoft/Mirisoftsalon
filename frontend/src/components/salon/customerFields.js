// One definition of a customer record's editable shape, shared by the
// Customers list and the customer profile page so the two never drift.
// Branch and salon are only offered where the caller passes their options.
export const customerFields = ({ branches, salons } = {}) => [
  { name: "name", label: "Customer name", required: true },
  { name: "phone", label: "Phone", type: "tel", required: true },
  { name: "email", label: "Email", type: "email", nullable: true },
  { name: "gst", label: "GST number", nullable: true },
  {
    name: "status",
    label: "Customer status",
    type: "select",
    defaultValue: "REGULAR",
    options: ["REGULAR", "PREMIUM", "IRREGULAR"].map((value) => ({
      value,
      label: value,
    })),
  },
  {
    name: "dateOfBirth",
    initialName: "dob",
    label: "Date of birth",
    type: "date",
    nullable: true,
  },
  {
    name: "anniversaryDate",
    label: "Anniversary date",
    type: "date",
    nullable: true,
  },
  ...(branches
    ? [
        {
          name: "branchId",
          label: "Branch",
          type: "select",
          nullable: true,
          options: branches.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        },
      ]
    : []),
  ...(salons
    ? [
        {
          name: "salonId",
          label: "Salon",
          type: "select",
          required: true,
          options: salons.map((item) => ({ value: item.id, label: item.name })),
        },
      ]
    : []),
  {
    name: "customNotes",
    label: "Customer notes",
    type: "textarea",
    fullWidth: true,
    nullable: true,
    rows: 3,
  },
];
