import React, { useEffect, useLayoutEffect, Fragment } from "react";
import Icon from "@/components/icon/Icon";
import classNames from "classnames";
import { NavLink, Link, useLocation } from "react-router";
import { slideUp, slideDown, getParents } from "@/utils/Utils";
import { useThemeUpdate } from '@/layout/provider/Theme';

const Menu = ({data}) => {

  const themeUpdate = useThemeUpdate();
  const location = useLocation();

  let currentLink = function(selector){
      let elm = document.querySelectorAll(selector);
      elm.forEach(function(item){
          var activeRouterLink = item.classList.contains('active');
          if (activeRouterLink) {
              let parents = getParents(item,`.nk-menu`, 'nk-menu-item');
              parents.forEach(parentElemets =>{
                  parentElemets.classList.add('active', 'current-page');
                  let subItem = parentElemets.querySelector(`.nk-menu-wrap`);
                  subItem !== null && (subItem.style.display = "block")
              })
              
          } else {
              item.parentElement.classList.remove('active', 'current-page');
          }
      })
  } 
  // dropdown toggle
  let dropdownToggle = function(elm){
      let parent = elm.parentElement;
      let nextelm = elm.nextElementSibling;
      let speed = nextelm.children.length > 5 ? 400 + nextelm.children.length * 10 : 400;
      if(!parent.classList.contains('active')){
          parent.classList.add('active');
          slideDown(nextelm,speed);
      }else{
          parent.classList.remove('active');
          slideUp(nextelm,speed);
      }
  }

  // dropdown close siblings
  let closeSiblings = function(elm){
      let parent = elm.parentElement;
      let siblings = parent.parentElement.children;
      Array.from(siblings).forEach(item => {
      if(item !== parent){
          item.classList.remove('active');
          if(item.classList.contains('has-sub')){
          let subitem = item.querySelectorAll(`.nk-menu-wrap`);
          subitem.forEach(child => {
              child.parentElement.classList.remove('active');
              slideUp(child,400);
          })
          }
      }
      });
  }

  let menuToggle = function(e){
      e.preventDefault();
      let item = e.target.closest(`.nk-menu-toggle`)
      dropdownToggle(item);
      closeSiblings(item);
  }

  let routeChange = function(e){
      let selector = document.querySelectorAll(".nk-menu-link")
      selector.forEach((item, index)=>{
          if(item.classList.contains('active')){
              closeSiblings(item);
              item.parentElement.classList.add("active");
          }else{
              item.parentElement.classList.remove("active");
              currentLink(`.nk-menu-link`);
          }
      })
  }
  
  useLayoutEffect(() =>{
      routeChange();
      themeUpdate.sidebarHide();
  },[location.pathname])

  useEffect(() =>{
      currentLink(`.nk-menu-link`);
      // eslint-disable-next-line
  },[null])


  return (
    <ul className="nk-menu">
      {data.map((item, index) =>
        <Fragment key={index}>
            {item.heading ? (
              <li className="nk-menu-heading">
                <h6 className="overline-title text-primary-alt">{item.heading}</h6>
              </li>
            ) : (
              <li className={classNames({'nk-menu-item': true, 'has-sub' : item.subMenu})}>
                {!item.subMenu ? (
                  <NavLink to={item.link} end className="nk-menu-link" target={item.newTab && '_blank'}>
                    {item.icon  && <span className="nk-menu-icon">
                      <Icon name={item.icon} />
                    </span>}
                    <span className="nk-menu-text">{item.text}</span>
                    {item.badge && <span className="nk-menu-badge">{item.badge}</span>}
                  </NavLink>
                  ) : (
                  <>
                    <a href="#" className="nk-menu-link nk-menu-toggle" onClick={menuToggle}>
                      {item.icon  && <span className="nk-menu-icon">
                        <Icon name={item.icon} />
                      </span>}
                      <span className="nk-menu-text">{item.text}</span>
                      {item.badge && <span className="nk-menu-badge">{item.badge}</span>}
                    </a>
                    <div className="nk-menu-wrap">
                      <ul className="nk-menu-sub">
                        {item.subMenu.map((sItem, sIndex) =>
                          <li className={classNames({'nk-menu-item': true, 'has-sub' : sItem.subMenu})} key={sIndex}>
                              {!sItem.subMenu ? (
                                <NavLink to={sItem.link} end className="nk-menu-link" target={sItem.newTab && '_blank'}>
                                  {sItem.icon && <Icon name={sItem.icon} className="me-1" />}
                                  <span className="nk-menu-text">{sItem.text}</span>
                                  {sItem.badge && <span className="nk-menu-badge">{sItem.badge}</span>}
                                </NavLink>
                                ) : (
                                <>
                                  <a href="#" className="nk-menu-link nk-menu-toggle" onClick={menuToggle}>
                                    <span className="nk-menu-text">{sItem.text}</span>
                                    {sItem.badge && <span className="nk-menu-badge">{sItem.badge}</span>}
                                  </a>
                                  <div className="nk-menu-wrap">
                                    <ul className="nk-menu-sub">
                                      {sItem.subMenu.map((s2Item, s2Index) =>
                                        <li className={classNames({'nk-menu-item': true, 'has-sub' : s2Item.subMenu})} key={s2Index}>
                                            {!s2Item.subMenu ? (
                                              <NavLink to={s2Item.link} end className="nk-menu-link" target={s2Item.newTab && '_blank'}>
                                                <span className="nk-menu-text">{s2Item.text}</span>
                                                {s2Item.badge && <span className="nk-menu-badge">{s2Item.badge}</span>}
                                              </NavLink>
                                              ) : (
                                              <>
                                                <a href="#" className="nk-menu-link nk-menu-toggle" onClick={menuToggle}>
                                                  <span className="nk-menu-text">{s2Item.text}</span>
                                                  {s2Item.badge && <span className="nk-menu-badge">{s2Item.badge}</span>}
                                                </a>
                                                <div className="nk-menu-wrap">
                                                  <ul className="nk-menu-sub">
                                                    {s2Item.subMenu.map((s3Item, s3Index) =>
                                                      <li className="nk-menu-item" key={s3Index}>
                                                          <NavLink to={s3Item.link} end className="nk-menu-link" target={s3Item.newTab && '_blank'}>
                                                            <span className="nk-menu-text">{s3Item.text}</span>
                                                            {s3Item.badge && <span className="nk-menu-badge">{s3Item.badge}</span>}
                                                          </NavLink>
                                                      </li>
                                                    )}
                                                  </ul>
                                                </div>
                                              </>
                                            )}
                                        </li>
                                      )}
                                    </ul>
                                  </div>
                                </>
                              )}
                          </li>
                        )}
                      </ul>
                    </div>
                  </>
                )}
              </li>
            )}
        </Fragment>
      )}
    </ul>
  );
};

export default Menu;
