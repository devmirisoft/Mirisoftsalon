import React from "react";
import BaseSelect from "react-select";
import BaseCreatableSelect from "react-select/creatable";

// react-select renders its menu inline, so any overflow ancestor
// (.table-responsive rows, modals, scrolling cards) clips it. Portal the menu
// to <body> and lift it clear of the theme chrome (sidebar 1021, modal 1051).
const menuPortal = (styles) => ({
  menuPortal: (base) => ({ ...base, zIndex: 1060 }),
  ...styles,
});

export const Select = ({ styles, ...props }) => (
  <BaseSelect
    menuPortalTarget={document.body}
    menuPosition="fixed"
    {...props}
    styles={menuPortal(styles)}
  />
);

export const CreatableSelect = ({ styles, ...props }) => (
  <BaseCreatableSelect
    menuPortalTarget={document.body}
    menuPosition="fixed"
    {...props}
    styles={menuPortal(styles)}
  />
);

export default Select;
