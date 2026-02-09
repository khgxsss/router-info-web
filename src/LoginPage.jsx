import React, { useState } from "react";

export default function LoginPage({ onLogin }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (
      (id === "webons" && pw === "webons!") ||
      (id === "rcn" && pw === "rcn!!")
    ) {
      onLogin(id);
    } else {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  return (
    <div style={styles.overlay}>
      {/* placeholder 색상을 위해 간단한 스타일 삽입 */}
      <style>{`
        .login-input::placeholder { color: #6b7280; }  /* 회색 텍스트 */
        .login-input:focus { outline: none; border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
      `}</style>

      <form onSubmit={handleSubmit} style={styles.form}>
        <h2 style={styles.title}>Router Info 로그인</h2>

        <input
          className="login-input"
          type="text"
          placeholder="아이디"
          value={id}
          onChange={(e) => setId(e.target.value)}
          style={styles.input}
        />

        <input
          className="login-input"
          type="password"
          placeholder="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={styles.input}
        />

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.button}>
          로그인
        </button>
      </form>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(180deg, #f9fafb 0%, #f3f4f6 100%)",
  },
  form: {
    background: "#ffffff",
    padding: "40px 50px",
    borderRadius: 16,
    boxShadow: "0 4px 24px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    width: 320,
    border: "1px solid #e5e7eb",
  },
  title: {
    textAlign: "center",
    marginBottom: 28,
    color: "#111827",
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: 0.2,
  },
  input: {
    marginBottom: 14,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#ffffff",     // 배경 확실히 화이트
    color: "#111827",          // ✅ 입력 글자 색 진하게
    caretColor: "#111827",     // 커서 색
    fontSize: 14,
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  button: {
    padding: "10px 0",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.25s",
  },
};
