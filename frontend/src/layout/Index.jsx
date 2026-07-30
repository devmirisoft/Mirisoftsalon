import { Outlet, useLocation } from "react-router-dom";
import getMenu from "./sidebar/MenuData";
import Sidebar from "./sidebar/Sidebar";
import Head from "./head/Head";
import Header from "./header/Header";
import Footer from "./footer/Footer";
import AppRoot from "./global/AppRoot";
import AppMain from "./global/AppMain";
import AppWrap from "./global/AppWrap";
import { useAuth } from "@/auth/AuthContext";
import FloatingAiAssistant from "@/components/FloatingAiAssistant";

const Layout = ({title}) => {
  const { user } = useAuth();
  const location = useLocation();
  const menu = getMenu(user?.role);
  const isJobCartPage = location.pathname.startsWith("/job-carts");
  return (
    <>
      <Head title={!title && 'Loading'} />
      <AppRoot>
        <AppMain>
          <Sidebar menuData={menu} fixed compact={isJobCartPage} />
          <AppWrap>
            <Header fixed />
              <Outlet />
            <Footer />
          </AppWrap>
        </AppMain>
      </AppRoot>
      <FloatingAiAssistant />
    </>
  );
};
export default Layout;
