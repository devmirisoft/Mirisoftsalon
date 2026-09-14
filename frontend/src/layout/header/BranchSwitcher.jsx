import { useState } from "react";
import { Dropdown, DropdownMenu, DropdownToggle } from "reactstrap";
import { Icon } from "@/components/Component";
import { useAuth } from "@/auth/AuthContext";

// Shows which branch the user is working in, and — for salon-wide roles — lets
// them open a session on any branch of their salon with one click. Everything
// the app then reads and writes is scoped to that branch until they switch back
// to All Branches.
const BranchSwitcher = () => {
  const { activeBranch, branch, branches, canSwitchBranch, switchBranch } =
    useAuth();
  const [open, setOpen] = useState(false);

  const label = canSwitchBranch
    ? activeBranch?.name || "All Branches"
    : branch?.name;

  if (!label) return null;

  if (!canSwitchBranch) {
    return (
      <div className="d-flex align-items-center gap-1 text-soft me-3">
        <Icon name="building" />
        <span className="fw-medium">{label}</span>
      </div>
    );
  }

  const pick = (next) => {
    setOpen(false);
    if ((next?.id || null) !== (activeBranch?.id || null)) switchBranch(next);
  };

  return (
    <Dropdown
      isOpen={open}
      toggle={() => setOpen((current) => !current)}
      className="me-3"
    >
      <DropdownToggle
        tag="a"
        href="#branch"
        className="dropdown-toggle btn btn-outline-light"
        onClick={(event) => event.preventDefault()}
      >
        <Icon name="building" />
        <span className="ms-1">{label}</span>
      </DropdownToggle>
      <DropdownMenu end className="dropdown-menu-md">
        <ul className="link-list-opt no-bdr">
          <li className={!activeBranch ? "active" : undefined}>
            <a href="#all" onClick={(event) => { event.preventDefault(); pick(null); }}>
              <Icon name="grid-alt" />
              <span>All Branches</span>
            </a>
          </li>
          <li className="divider"></li>
          {branches.map((option) => (
            <li
              key={option.id}
              className={option.id === activeBranch?.id ? "active" : undefined}
            >
              <a
                href={`#branch-${option.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  pick({ id: option.id, name: option.name });
                }}
              >
                <Icon name="building" />
                <span>{option.name}</span>
              </a>
            </li>
          ))}
          {branches.length === 0 && (
            <li>
              <span className="px-3 text-soft">No branches found</span>
            </li>
          )}
        </ul>
      </DropdownMenu>
    </Dropdown>
  );
};

export default BranchSwitcher;
