import React, { useState, useEffect } from "react";
import LoginPage from "./LoginPage";
import Dashboard from "./Dashboard";

export default function App() {
  // ✅ 새로고침해도 남아있게 localStorage 이용
  const [user, setUser] = useState(() => localStorage.getItem("user"));

  // ✅ 로그인 상태 변경될 때마다 localStorage에 반영
  useEffect(() => {
    if (user) localStorage.setItem("user", user);
    else localStorage.removeItem("user");
  }, [user]);

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}
