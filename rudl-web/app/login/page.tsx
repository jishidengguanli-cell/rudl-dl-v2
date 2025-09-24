"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("...");
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      location.href = "/dashboard";
    } else {
      setMsg(await res.text());
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Login</h1>
      <form onSubmit={submit} className="space-y-3 max-w-sm">
        <input className="input" placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="input" placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button className="btn">Login</button>
        <a className="ml-3 text-sm underline" href="/register">Register</a>
      </form>
      {msg && <div className="text-sm text-red-600">{msg}</div>}
    </div>
  );
}
