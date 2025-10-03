"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type Platform = "apk" | "ipa";

const isPlatform = (value: string): value is Platform => value === "apk" || value === "ipa";

export default function BillPlayground() {
  const [accountId, setAccountId] = useState("owner_1");
  const [linkId, setLinkId] = useState("link_1");
  const [platform, setPlatform] = useState<Platform>("apk");
  const [out, setOut] = useState<string>("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOut("loading...");
    try {
      const response = await fetch("/api/dl/bill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: accountId, link_id: linkId, platform })
      });
      const payload: unknown = await response.json();
      setOut(JSON.stringify(payload, null, 2));
    } catch (error: unknown) {
      if (error instanceof Error) {
        setOut(error.message);
        return;
      }
      try {
        setOut(JSON.stringify(error, null, 2));
      } catch {
        setOut(String(error));
      }
    }
  };

  const onPlatformChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (isPlatform(nextValue)) {
      setPlatform(nextValue);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <h2 className="text-lg font-medium">扣點測試</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <div className="mb-1">account_id</div>
            <input className="w-full rounded border px-2 py-1" value={accountId} onChange={event => setAccountId(event.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1">link_id</div>
            <input className="w-full rounded border px-2 py-1" value={linkId} onChange={event => setLinkId(event.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1">platform</div>
            <select className="w-full rounded border px-2 py-1" value={platform} onChange={onPlatformChange}>
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
