"use client";

import { useEffect, useMemo, useState } from "react";

/** ---- 타입 ---- */
type Choice = { text: string; next: string; effects?: Record<string, number> };
type Scene =
  | { id: string; kind: "scene"; body: string[]; choices: Choice[] }
  | { id: string; kind: "ending"; title: string; body: string[] };
type Scenario = { title: string; start: string; scenes: Scene[] };

/** ---- 간단 검증 ---- */
function validateScenario(data: any): asserts data is Scenario {
  if (!data || typeof data !== "object") throw new Error("JSON이 아닙니다.");
  if (typeof data.title !== "string") throw new Error("title 누락");
  if (typeof data.start !== "string") throw new Error("start 누락");
  if (!Array.isArray(data.scenes)) throw new Error("scenes 배열 누락");
  if (!data.scenes.some((s: any) => s.id === data.start))
    throw new Error("start와 일치하는 장면 id가 없습니다.");
}

/** ---- 컴포넌트 ---- */
export default function Home() {
  // 로딩/오류/시나리오 상태
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);

  // 플레이 상태
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [vars, setVars] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<string[]>([]);

  /** 처음엔 기본 scenario.json 로드 (혹시 이전에 업로드한 게 있으면 그걸 복원) */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const cached = localStorage.getItem("uploadedScenario");
        if (cached) {
          const data = JSON.parse(cached);
          validateScenario(data);
          setScenario(data);
          setSceneId(data.start);
          setHistory([data.start]);
          return;
        }

        const res = await fetch("/scenario.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Scenario = await res.json();
        validateScenario(data);
        setScenario(data);
        setSceneId(data.start);
        setHistory([data.start]);
      } catch (e: any) {
        setError(e?.message ?? "불러오기 오류");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** 업로드 핸들러 */
  /** ---- TXT → JSON 파서 ---- */
async function onTxtUpload(file: File) {
  try {
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
        const match = line.match(/^>\s*(.*?)\s*->\s*(\S+)(?:\s*\((.*?)\))?/);
        if (match) {
          const [, text, next, effStr] = match;
          const effects: Record<string, number> = {};
          if (effStr) {
            for (const eff of effStr.split(/[, ]+/)) {
              if (!eff) continue;
              const m = eff.match(/^([+-]?)([a-zA-Z_]+)/);
              if (m) effects[m[2]] = m[1] === "-" ? -1 : 1;
            }
          }
          current.choices.push({ text, next, effects: Object.keys(effects).length ? effects : undefined });
        }
      } else {
        // 본문
        if (current) {
          if (current.kind === "ending" && !current.title && line.startsWith("엔딩:"))
            current.title = line;
          else current.body.push(line);
        }
      }
    }
    if (current) scenes.push(current);

    const scenario = {
      title: file.name.replace(/\.\w+$/, ""),
      start: scenes[0]?.id ?? "start",
      scenes
    };

    // 시나리오 검증 후 적용
    validateScenario(scenario);
    setScenario(scenario);
    setSceneId(scenario.start);
    setVars({});
    setHistory([scenario.start]);
    localStorage.setItem("uploadedScenario", JSON.stringify(scenario));
    setError(null);
  } catch (e: any) {
    setError(`TXT 변환 실패: ${e?.message ?? e}`);
  }
}

  async function onUpload(file: File) {
    try {
      setError(null);
      const text = await file.text();
      const data = JSON.parse(text);
      validateScenario(data);
      setScenario(data);
      setSceneId(data.start);
      setVars({});
      setHistory([data.start]);
      localStorage.setItem("uploadedScenario", JSON.stringify(data));
    } catch (e: any) {
      setError(`업로드 실패: ${e?.message ?? e}`);
    }
  }

  /** 업로드 리셋(기본 시나리오로 복귀) */
  async function resetToDefault() {
    localStorage.removeItem("uploadedScenario");
    setLoading(true);
    setVars({});
    setHistory([]);
    try {
      const res = await fetch("/scenario.json", { cache: "no-store" });
      const data: Scenario = await res.json();
      validateScenario(data);
      setScenario(data);
      setSceneId(data.start);
      setHistory([data.start]);
      setError(null);
    } catch (e: any) {
      setError(`기본 시나리오 로드 실패: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  const scene = useMemo(
    () => scenario?.scenes.find((s) => s.id === sceneId!),
    [scenario, sceneId]
  );

  function applyEffects(effects?: Record<string, number>) {
    if (!effects) return;
    setVars((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(effects)) {
        next[k] = (next[k] ?? 0) + v;
      }
      return next;
    });
  }

  function go(nextId: string, effects?: Record<string, number>) {
    applyEffects(effects);
    setSceneId(nextId);
    setHistory((h) => [...h, nextId]);
  }

  function back() {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const copy = [...h];
      copy.pop();
      const prev = copy[copy.length - 1];
      setSceneId(prev);
      return copy;
    });
  }

  /** 로딩/에러/미초기화 처리 */
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">시나리오 불러오는 중…</p>
      </main>
    );
  }
  if (error || !scenario || !sceneId || !scene) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="mb-3 text-red-600">문제 발생: {error ?? "알 수 없는 오류"}</p>
          <button className="px-4 py-2 rounded bg-black text-white" onClick={() => location.reload()}>
            새로고침
          </button>
        </div>
      </main>
    );
  }

  const isEnding = scene.kind === "ending";

  return (
    <main className="min-h-screen flex flex-col items-center p-6">
      <div className="w-full max-w-2xl">
        {/* 상단 바 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">🎭 {scenario.title}</h1>
            <span className="text-xs text-gray-500">(현재: {sceneId})</span>
          </div>
          <div className="flex gap-2 items-center">
            {Object.entries(vars).map(([k, v]) => (
              <span key={k} className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 text-sm">
                {k}: {v}
              </span>
            ))}

            {/* TXT 업로더 */}
<label className="cursor-pointer px-3 py-1.5 rounded bg-green-500 text-white text-sm hover:bg-green-600">
  TXT 업로드
  <input
    type="file"
    accept=".txt,text/plain"
    className="hidden"
    onChange={(e) => {
      const f = e.target.files?.[0];
      if (f) onTxtUpload(f);
    }}
  />
</label>

            <button
              className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
              onClick={resetToDefault}
              title="기본 시나리오로 돌아가기"
            >
              기본으로
            </button>
          </div>
        </div>

        {/* 본문 */}
        <article className="rounded-2xl border p-6 bg-white shadow-sm">
          {isEnding ? (
            <>
              <h2 className="text-2xl font-bold mb-3">{(scene as Extract<Scene, { kind: "ending" }>).title}</h2>
              {scene.body.map((line, i) => (
                <p key={i} className="mb-3 leading-relaxed">{line}</p>
              ))}
              <div className="mt-6 flex gap-2">
                <button className="px-4 py-2 rounded bg-gray-200" onClick={back}>← 한 장면 뒤로</button>
                <button
                  className="px-4 py-2 rounded bg-black text-white"
                  onClick={() => { setVars({}); setSceneId(scenario.start); setHistory([scenario.start]); }}
                >
                  처음으로
                </button>
              </div>
            </>
          ) : (
            <>
              {scene.body.map((line, i) => (
                <p key={i} className="mb-3 leading-relaxed">{line}</p>
              ))}
              <div className="mt-6 grid gap-3">
                {(scene as Extract<Scene, { kind: "scene" }>).choices.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => go(c.next, c.effects)}
                    className="px-4 py-3 rounded-lg border border-blue-400 bg-blue-500 text-white font-medium hover:bg-blue-600 hover:border-blue-500 transition-colors duration-150 text-left shadow-sm"
                  >
                    ➤ {c.text}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <button className="text-sm text-blue-600 hover:underline" onClick={back}>← 한 장면 뒤로</button>
              </div>
            </>
          )}
        </article>
      </div>
    </main>
  );
}
