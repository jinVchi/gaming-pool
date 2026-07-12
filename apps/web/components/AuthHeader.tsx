"use client";

import { useState, type FormEvent } from "react";
import { authClient, useSession } from "@/lib/auth-client";

type Mode = "signin" | "signup" | null;

export function AuthHeader() {
  const { data: session, isPending } = useSession();
  const [mode, setMode] = useState<Mode>(null);
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setIdentifier("");
    setEmail("");
    setUsername("");
    setPassword("");
    setName("");
    setError(null);
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // The username plugin's sign-in endpoint accepts either a username or an
    // email in this field — matches AGENTS.md's "login with email or username".
    const { error: signInError } = await authClient.signIn.username({ username: identifier, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? "Sign in failed");
      return;
    }
    switchTo(null);
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      email,
      password,
      name: name || username,
      username,
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message ?? "Sign up failed");
      return;
    }
    switchTo(null);
  }

  if (isPending) {
    return <div className="auth-header" />;
  }

  if (session?.user) {
    return (
      <div className="auth-header">
        <span className="auth-username">{session.user.name}</span>
        <button type="button" className="auth-link-button" onClick={() => authClient.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-header">
      <button type="button" className="auth-link-button" onClick={() => switchTo(mode === "signin" ? null : "signin")}>
        Sign in
      </button>
      <button
        type="button"
        className="play-button auth-signup-button"
        onClick={() => switchTo(mode === "signup" ? null : "signup")}
      >
        Sign up
      </button>

      {mode && (
        <div className="auth-popover">
          {mode === "signin" ? (
            <form onSubmit={handleSignIn}>
              <input
                type="text"
                placeholder="Email or account name"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="play-button" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
              <p className="auth-switch">
                No account?{" "}
                <button type="button" className="auth-link-button" onClick={() => switchTo("signup")}>
                  Sign up
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignUp}>
              <input
                type="text"
                placeholder="Nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Account name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="play-button" disabled={loading}>
                {loading ? "Creating account..." : "Sign up"}
              </button>
              <p className="auth-switch">
                Already have an account?{" "}
                <button type="button" className="auth-link-button" onClick={() => switchTo("signin")}>
                  Sign in
                </button>
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
