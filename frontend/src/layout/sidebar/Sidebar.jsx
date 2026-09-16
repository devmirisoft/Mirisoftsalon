import React, { useState } from "react";
import classNames from "classnames";
import SimpleBar from "simplebar-react";
import BrandText from "../../../public/Mirisoft-text.png";
import Menu from "../menu/Menu";
import Toggle from "./Toggle";

import { useTheme, useThemeUpdate } from '@/layout/provider/Theme';

const Sidebar = ({ fixed, className, compact = false, menuData, ...props }) => {

  const theme = useTheme();
  const themeUpdate = useThemeUpdate();
  const isCompact = compact || theme.sidebarCompact;

  const [mouseEnter, setMouseEnter] = useState(false);

  const handleMouseEnter = () => setMouseEnter(true);
  const handleMouseLeave = () => setMouseEnter(false);

  const classes = classNames({
    "nk-sidebar": true,
    "nk-sidebar-fixed": fixed,
    "nk-sidebar-active": theme.sidebarVisibility,
    "nk-sidebar-mobile": theme.sidebarMobile,
    "is-compact": isCompact,
    "has-hover": isCompact && mouseEnter,
    [`is-light`]: theme.sidebar === "white",
    [`is-${theme.sidebar}`]: theme.sidebar !== "white" && theme.sidebar !== "light",
    [`${className}`]: className,
  });

  return (
    <>
      <div className={classes}>
        <div className="nk-sidebar-element nk-sidebar-head">
          <div className="nk-menu-trigger">
            <Toggle className="nk-nav-toggle nk-quick-nav-icon d-xl-none me-n2" img size={40} click={themeUpdate.sidebarVisibility} />
            <Toggle
              className={`nk-nav-compact nk-quick-nav-icon d-none d-xl-inline-flex ${
                isCompact ? "compact-active" : ""
              }`}
              click={themeUpdate.sidebarCompact}
              img
              size={40}
            />
          </div>
          <div className="nk-sidebar-brand">
            <img
              src={BrandText}
              alt="Mirisoft"
              style={{ display: "block", width: "100%", maxHeight: "44px", objectFit: "contain", marginLeft: "-12px" }}
            />
          </div>
        </div>
        <div className="nk-sidebar-content" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <SimpleBar className="nk-sidebar-menu">
            <Menu data={menuData} />
          </SimpleBar>
          
        </div>
      </div>
      {theme.sidebarVisibility && <div 
      onClick={themeUpdate.sidebarVisibility}
       className="nk-sidebar-overlay"></div>}
    </>
  );
};
export default Sidebar;
