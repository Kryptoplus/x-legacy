import React from "react";
import { useDynamicContext, DynamicNav } from "@dynamic-labs/sdk-react-core";
// import "./AppNavigation.css"; // Optional for additional styles

const AppNavigation = () => {
  const { user } = useDynamicContext();

  return (
    <nav className="nav">
      <a className="nav__element" href="/">Home</a>
      {user && (
        <div className="nav__element">
          <DynamicNav />
        </div>
      )}
    </nav>
  );
};

export default AppNavigation;
