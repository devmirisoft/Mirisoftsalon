/* eslint-disable react/prop-types */
import React from "react";
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from "reactstrap";
import { Icon } from "@/components/Component";

// Row actions are authored as JSX (usually <Button> elements wrapped in
// fragments and conditionals). Flatten that tree so each button can be replayed
// as an entry inside the three-dot menu instead of a separate toolbar button.
export const flattenActionNodes = (node, collected = []) => {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      flattenActionNodes(child.props.children, collected);
    } else {
      collected.push(child);
    }
  });
  return collected;
};

// A button's children mix an <Icon /> with its label; split them so the menu can
// keep the theme's "icon then text" layout consistent across every action.
const splitIconAndLabel = (children) => {
  const parts = React.Children.toArray(children);
  const iconNode = parts.find(
    (part) => React.isValidElement(part) && part.props?.name && part.type !== "span",
  );
  const labelParts = parts.filter((part) => part !== iconNode);
  const hasLabel = labelParts.some(
    (part) => typeof part !== "string" || part.trim() !== "",
  );
  return { iconNode, labelParts: hasLabel ? labelParts : null };
};

// Icon-only buttons carry no text, so fall back to the button's title or a
// readable form of the icon name ("printer-fill" -> "Printer").
const humanizeIconName = (name) => {
  const base = String(name).replace(/-(fill|alt)$/g, "").replace(/-/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
};

const resolveActionLabel = (action, labelParts, iconNode) => {
  if (labelParts) return labelParts;
  if (action.props?.title) return action.props.title;
  if (iconNode?.props?.name) return humanizeIconName(iconNode.props.name);
  return "Action";
};

export const ActionMenuItem = ({ icon, label, onClick, disabled, className }) => (
  <li className={disabled ? "disabled" : undefined}>
    <DropdownItem
      tag="a"
      href="#action"
      disabled={disabled}
      className={className}
      onClick={(ev) => {
        ev.preventDefault();
        if (!disabled) onClick?.(ev);
      }}
    >
      {icon}
      <span>{label}</span>
    </DropdownItem>
  </li>
);

// Renders arbitrary action JSX as a three-dot dropdown. `children` holds the
// buttons to convert; `leading`/`trailing` are already-built menu items.
const RowActionsMenu = ({ children, leading, trailing }) => {
  const actions = flattenActionNodes(children);
  if (!leading && !trailing && actions.length === 0) return null;

  return (
    <UncontrolledDropdown>
      <DropdownToggle
        tag="a"
        className="dropdown-toggle btn btn-icon btn-trigger"
        title="Actions"
      >
        <Icon name="more-h" />
      </DropdownToggle>
      {/* Portal to <body>: .table-responsive sets overflow-x, which would
          otherwise clip menus opened on the last rows of a table. */}
      <DropdownMenu end container="body">
        <ul className="link-list-opt no-bdr">
          {leading}
          {actions.map((action, index) => {
            const { iconNode, labelParts } = splitIconAndLabel(
              action.props?.children,
            );
            return (
              <ActionMenuItem
                key={action.key ?? `action-${index}`}
                icon={iconNode}
                label={resolveActionLabel(action, labelParts, iconNode)}
                disabled={action.props?.disabled}
                onClick={action.props?.onClick}
              />
            );
          })}
          {trailing}
        </ul>
      </DropdownMenu>
    </UncontrolledDropdown>
  );
};

export default RowActionsMenu;
