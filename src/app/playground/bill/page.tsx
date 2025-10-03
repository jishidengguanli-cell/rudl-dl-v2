"use client";

import { useState } from "react";

export default function BillPlayground() {
  const [accountId, setAccountId] = useState("owner_1");
  const [linkId, setLinkId] = useState("link_1");
  const [platform, setPlatform] = useState<"apk"|"ipa">("apk");
  const [out, setOut] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut("loading...");
    try {
      const r = await fetch("/api/dl/bill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: accountId, link_id: linkId, platform })
      });
      const j = await r.json();
      setOut(JSON.stringify(j, null, 2));
    } catch (err:any) {
      setOut(String(err));
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <h2 className="text-lg font-medium">扣點測試</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <div className="mb-1">account_id</div>
            <input className="w-full rounded border px-2 py-1" value={accountId} onChange={e=>setAccountId(e.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1">link_id</div>
            <input className="w-full rounded border px-2 py-1" value={linkId} onChange={e=>setLinkId(e.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1">platform</div>
            <select className="w-full rounded border px-2 py-1" value={platform} onChange={e=>setPlatform(e.target.value as any)}>
              <option value="apk">apk</option>
              <option value="ipa">ipa</option>
            </select>
          </label>
        </div>
        <button className="rounded bg-black px-3 py-1 text-white">送出</button>
      </form>
      <pre className="overflow-auto rounded bg-gray-100 p-3 text-xs">{out}</pre>
    </div>
  );
}
