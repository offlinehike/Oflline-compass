import React, { useState } from "react";
import { supabase } from "./supabase";

const ALLOWED_EMAIL = "offlinehike@gmail.com";

const S = {
  wrap: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#FFF6F1",
    padding: "24px 20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "32px 24px",
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  logo: {
    fontSize: 40,
    textAlign: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    textAlign: "center",
    color: "#0F172A",
    marginBottom: 4,
  },
  sub: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 28,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 6,
    display: "block",
  },
  input: {
    width: "100%",
    padding: "13px 14px",
    border: "1px solid #D7DCE1",
    borderRadius: 12,
    fontSize: 16,
    color: "#0F172A",
    boxSizing: "border-box",
    marginBottom: 16,
    outline: "none",
  },
  btn: {
    width: "100%",
    padding: "14px",
    border: "none",
    borderRadius: 13,
    background: "#F97316",
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  msg: {
    marginTop: 16,
    padding: "12px 14px",
    borderRadius: 12,
    fontSize: 14,
    textAlign: "center",
  },
  msgOk: { background: "#F0FDF4", color: "#16A34A" },
  msgErr: { background: "#FEF2F2", color: "#DC2626" },
  footer: {
    marginTop: 28,
    fontSize: 12,
    color: "#94A3B8",
    textAlign: "center",
  },
};

export default function AuthScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed !== ALLOWED_EMAIL) {
      setError("Access restricted. Use your registered email.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.logo}>🧭</div>
        <div style={S.title}>Offline Compass</div>
        <div style={S.sub}>Trail & booking ledger · Mauritius</div>

        {!sent ? (
          <>
            <label style={S.label}>Email</label>
            <input
              style={S.input}
              type="email"
              placeholder="offlinehike@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKey}
              autoComplete="email"
            />
            <button
              style={{ ...S.btn, ...(loading ? S.btnDisabled : {}) }}
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Sending…" : "Send Magic Link"}
            </button>
            {error && <div style={{ ...S.msg, ...S.msgErr }}>{error}</div>}
          </>
        ) : (
          <div style={{ ...S.msg, ...S.msgOk }}>
            ✅ Check your inbox — click the link in the email to sign in.
          </div>
        )}

        <div style={S.footer}>Private access · Offline Compass Ltd</div>
      </div>
    </div>
  );
}
