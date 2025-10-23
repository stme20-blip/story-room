"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/* ---- 로비에서도 TXT → JSON 파서 사용 ---- */
type Choice = { text: string; next: string; effects?: Record<string, number> };
type Scene =
  | { id: string; kind: "scene"; body: string[]; choices: Choice[] }
  | { id: string; kind: "ending"; title: string; body: string[] };
type Scenario = { title: string; start: string; scenes: Scene[] };

function validateScenario(data: any): asserts data is Scenario {
  if (!data || typeof data !== "object") throw new Error("JSON이 아닙니다.");
  if (typeof data.title !== "string") throw new Error("title 누락");
  if (typeof data.start !== "string") throw new Error("start 누락");
  if (!Array.isArray(data.scenes)) throw new Error("scenes 배열 누락");
  if (!data.scenes.some((s: any) => s.id === data.start))
    throw new Error("start와 일치하는 장면 id가 없습니다.");
}
async function parseTxtToScenario(file: File): Promise<Scenario> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const scenes: any[] = [];
  let current: any = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#scene ")) {
      if (current) scenes.push(current);
      current = { id: line.split(" ")[1], kind: "scene", body: [], choices: [] };
    } else if (line.startsWith("#ending ")) {
      if (current) scenes.push(current);
      current = { id: line.split(" ")[1], kind: "ending", title: "", body: [] };
    } else if (line.startsWith(">")) {
      if (!current || current.kind !== "scene") continue;
      const m = line.match(/^>\s*(.*?)\s*->\s*(\S+)(?:\s*\((.*?)\))?/);
      if (m) {
        const [, t, next, effStr] = m;
        const effects: Record<string, number> = {};
        if (effStr) {
          for (const eff of effStr.split(/[, ]+/)) {
            if (!eff) continue;
            const mm = eff.match(/^([+-]?)([a-zA-Z_]+)/);
            if (mm) effects[mm[2]] = mm[1] === "-" ? -1 : 1;
          }
        }
        current.choices.push({ text: t, next, effects: Object.keys(effects).length ? effects : undefined });
      }
    } else {
      if (current) {
        if (current.kind === "ending" && !current.title && line.startsWith("엔딩:"))
          current.title = line;
        else current.body.push(line);
      }
    }
  }
  if (current) scenes.push(current);

  const scenario: Scenario = {
    title: file.name.replace(/\.\w+$/, ""),
    start: scenes[0]?.id ?? "start",
    scenes,
  };
  validateScenario(scenario);
  return scenario;
}

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
const keyForRoom = (room: string) => `duoScenario:${room.toUpperCase()}`;

export default function DuoLobby() {
  const [room, setRoom] = useState("");
  const [role, setRole] = useState<"P1" | "P2">("P1");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canEnter = useMemo(() => room.trim().length >= 4, [room]);
  const canEnterWithName = canEnter && name.trim().length > 0;

  async function uploadTXT(f: File) {
    try {
      setError(null);
      const scenario = await parseTxtToScenario(f);
      localStorage.setItem(keyForRoom(room), JSON.stringify(scenario));
      alert("✅ TXT 변환·업로드 완료! 이제 '입장'을 눌러 방으로 들어가세요.");
    } catch (e: any) {
      setError(`TXT 업로드 실패: ${e?.message ?? e}`);
    }
  }
  function useDefault() {
    localStorage.removeItem(keyForRoom(room));
    alert("➡ 기본 시나리오로 플레이합니다. '입장'을 눌러주세요.");
  }

  const enterHref = canEnterWithName
    ? `/duo/room/${room}?as=${role}&name=${encodeURIComponent(name)}`
    : "#";

  return (
    <main className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-bold mb-1">🧑‍🤝‍🧑 로비</h1>
        <p className="text-gray-600 mb-4">방 코드를 정하고, 플레이어 이름을 입력한 뒤 입장하세요.</p>

        <div className="rounded-xl border p-4 mb-4">
          <div className="flex gap-2 items-center mb-3">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
              placeholder="방 코드 입력 (예: ABC123)"
              className="flex-1 px-3 py-2 rounded border"
            />
            <button
              className="px-3 py-2 rounded bg-emerald-500 text-white hover:bg-emerald-600"
              onClick={() => setRoom(randomRoomCode())}
            >
              코드 생성
            </button>
          </div>

          {/* 플레이어 설정 */}
          <div className="flex gap-2 items-center mb-3">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "P1" | "P2")}
              className="px-2 py-2 rounded border"
            >
              <option value="P1">P1</option>
              <option value="P2">P2</option>
            </select>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="플레이어 이름"
              className="flex-1 px-3 py-2 rounded border"
            />
          </div>

          {/* 업로더 */}
          <div className="flex flex-wrap gap-2 items-center">
            <label className={`cursor-pointer px-3 py-1.5 rounded text-white text-sm ${canEnter ? "bg-green-500 hover:bg-green-600" : "bg-gray-300"}`}>
              TXT 업로드
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadTXT(f);
                }}
                disabled={!canEnter}
              />
            </label>
            <button
              className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={useDefault}
              disabled={!canEnter}
              title="기본 시나리오 사용"
            >
              기본 시나리오
            </button>
          </div>

          {error && <p className="text-red-600 text-sm mt-2">⚠ {error}</p>}
        </div>

        {/* 입장 */}
        <div className="rounded-xl border p-4 mb-6">
          <h2 className="font-semibold mb-2">방 입장</h2>
          <div className="flex items-center gap-2">
            <Link
              href={enterHref}
              className={`px-4 py-2 rounded ${canEnterWithName ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300"} text-white`}
              aria-disabled={!canEnterWithName}
              onClick={() => {
                if (!canEnterWithName) return;
                // (선택) 이름을 캐시로도 저장해두고 싶다면:
                localStorage.setItem(`duoName:${room}:${role}`, name.trim());
              }}
            >
              입장
            </Link>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            같은 방 코드와 다른 역할로 상대에게 링크를 공유하세요.
          </p>
        </div>

        <Link href="/" className="text-blue-600 hover:underline">← 메인으로</Link>
      </div>
    </main>
  );
}
