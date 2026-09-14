import React from "react";
import Select from "react-select";

const RSelect = ({ styles, ...props }) => {
  return (
    <div className="form-control-select">
      <Select
        className={`react-select-container ${props.className ? props.className : ""}`}
        classNamePrefix="react-select"
        // Portal to <body> so cards, modals and .table-responsive (overflow)
        // can't clip the menu; zIndex clears the theme chrome (sidebar 1021,
        // modal 1051).
        menuPortalTarget={document.body}
        menuPosition="fixed"
        {...props}
        styles={{
          menuPortal: (base) => ({ ...base, zIndex: 1060 }),
          ...styles,
        }}
      />
    </div>
  );
};

export default RSelect;
