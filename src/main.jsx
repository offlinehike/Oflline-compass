import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase";
import AuthScreen from "./AuthScreen";
import TrailLedger from "./TrailLedger";

function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth changes (sign in / sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Loading state
  if (session === undefined) {
    return (
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FFF6F1",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 28,
      }}>
        🧭
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return <AuthScreen />;
  }

  // Logged in — show the app, handing it the session so cloud sync knows the user
  return <TrailLedger session={session} />;
}

createRoot(document.getElementById("root")).render(<App />);
