import React, { useState } from "react";
import { supabase } from "./supabase";

export default function ResetPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (pw.length < 8) return setMsg("Use at least 8 characters.");
    if (pw !== pw2) return setMsg("Passwords don't match.");
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg(error.message);
    onDone();
  };

  const handleKey = (e) => {
    if (e.key === "Enter") save();
  };

  const input = {
    width: "100%",
    padding: 13,
    fontSize: 16,
    marginBottom: 14,
    boxSizing: "border-box",
    border: "1px solid #D7DCE1",
    borderRadius: 12,
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FFF6F1",
        padding: 20,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>Set a new password</div>
        <input
          style={input}
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={handleKey}
          autoComplete="new-password"
        />
        <input
          style={input}
          type="password"
          placeholder="Repeat it"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={handleKey}
          autoComplete="new-password"
        />
        <button
          onClick={save}
          disabled={busy}
          style={{
            width: "100%",
            padding: 14,
            border: "none",
            borderRadius: 13,
            background: "#F97316",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : "Save password"}
        </button>
        {msg && <div style={{ marginTop: 14, color: "#DC2626", fontSize: 14 }}>{msg}</div>}
      </div>
    </div>
  );
}
