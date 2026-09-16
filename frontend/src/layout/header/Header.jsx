import React, { useState } from "react";
import classNames from "classnames";
import Toggle from "../sidebar/Toggle";
import Logo from "../logo/Logo";
import News from "../news/News";
import User from "./dropdown/user/User";
import Notification from "./dropdown/notification/Notification";

import { Link } from "react-router-dom";
import Icon from "@/components/icon/Icon";
import { useAuth } from "@/auth/AuthContext";
import { allowsRole } from "@/utils/salonFormat";
import QuickSell from "./QuickSell";
import BranchSwitcher from "./BranchSwitcher";

import { useTheme, useThemeUpdate } from '../provider/Theme';

const SHORTCUTS = [
  { to: "/job-carts/create", icon: "cart", text: "Create Job Cart", roles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"] },
  { to: "/customers", icon: "users", text: "Customers", roles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"] },
  { sell: "MEMBERSHIP", icon: "award-fill", text: "Sell Membership", roles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"] },
  { sell: "PACKAGE", icon: "gift", text: "Sell Packages", roles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"] },
];

const Header = ({ fixed, className, ...props }) => {

  const theme = useTheme();
  const themeUpdate = useThemeUpdate();
  const { user } = useAuth();
  const [sellKind, setSellKind] = useState("");

  const headerClass = classNames({
    "nk-header": true,
    "nk-header-fixed": fixed,
    [`is-light`]: theme.header === "white",
    [`is-${theme.header}`]: theme.header !== "white" && theme.header !== "light",
    [`${className}`]: className,
  });
  return (
    <div className={headerClass}>
      <div className="container-fluid">
        <div className="nk-header-wrap">
          <div className="nk-menu-trigger d-xl-none ms-n1">
            <Toggle
              className="nk-nav-toggle nk-quick-nav-icon d-xl-none ms-n1"
              img
              click={themeUpdate.sidebarVisibility}
            />
          </div>
          <div className="nk-header-brand d-xl-none">
            <Logo />
          </div>
          <div className="nk-header-news d-none d-xl-block">
            <News />
          </div>
          <div className="ms-auto d-flex align-items-center">
            <BranchSwitcher />
          </div>
          <ul className="d-none d-sm-flex align-items-center gap-2 me-3 mb-0 list-unstyled">
            {SHORTCUTS.filter((item) => allowsRole(item.roles, user?.role)).map(
              (item) => {
                const label = (
                  <>
                    <Icon name={item.icon} />
                    <span className="d-none d-xl-inline">{item.text}</span>
                  </>
                );
                return (
                  <li key={item.text}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="nk-quick-btn"
                        title={item.text}
                      >
                        {label}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="nk-quick-btn"
                        title={item.text}
                        onClick={() => setSellKind(item.sell)}
                      >
                        {label}
                      </button>
                    )}
                  </li>
                );
              }
            )}
          </ul>
          <div className="nk-header-tools">
            <ul className="nk-quick-nav">
              <li className="user-dropdown">
                <User/>
              </li>
              <li className="notification-dropdown me-n1">
                <Notification />
              </li>
            </ul>
          </div>
        </div>
      </div>
      {sellKind && (
        <QuickSell kind={sellKind} onClose={() => setSellKind("")} />
      )}
    </div>
  );
};
export default Header;
