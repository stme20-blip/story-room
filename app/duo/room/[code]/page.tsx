"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

/* ---------- 타입 ---------- */
type Choice = { text: string; next: string; effects?: Record<string, number> };
type Scene =
  | { id: string; kind: "scene"; body: string[]; choices: Choice[] }
  | { id: string; kind: "ending"; title: string; body: string[] };
type Scenario = { title: string; start: string; scenes: Scene[] };
type Turn = "P1" | "P2";
type SharedState = { sceneId: string; vars: Record<string, number>; turn: Turn; version: number };
type Message = {
  id: string;
  role: Turn;
  name: string;
  sceneId: string;
  choiceText: string;
  text: string;
  ts: number;
  edited?: boolean;
};

/* ---------- 유틸 ---------- */
function validateScenario(data: any): asserts data is Scenario {
  if (!data || typeof data !== "object") throw new Error("JSON이 아닙니다.");
  if (typeof data.title !== "string") throw new Error("title 누락");
  if (typeof data.start !== "string") throw new Error("start 누락");
  if (!Array.isArray(data.scenes)) throw new Error("scenes 배열 누락");
}
function applyEffects(vars: Record<string, number>, effects?: Record<string, number>) {
  if (!effects) return vars;
  const next = { ...vars };
  for (const [k, v] of Object.entries(effects)) next[k] = (next[k] ?? 0) + v;
  return next;
}
const scenarioKey = (code: string) => `duoScenario:${code.toUpperCase()}`;
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/* ---------- 컴포넌트 ---------- */
export default function DuoRoom() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const role = (search.get("as") === "P2" ? "P2" : "P1") as Turn;
  const displayName = (search.get("name") || "").trim() || role;
  const code = (params?.code ?? "").toString().toUpperCase();

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [shared, setShared] = useState<SharedState | null>(null);
  const sharedRef = useRef<SharedState | null>(null);
  const [loading, setLoading] = useState(true);

  const [peers, setPeers] = useState<string[]>([]);
  const [logs, setLogs] = useState<Message[]>([]);
  const [composerChoice, setComposerChoice] = useState<Choice | null>(null);
  const [composerText, setComposerText] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const redirectedRef = useRef(false); // 중복 P1 감지 후 한 번만 리다이렉트

  // sharedRef 항상 최신화
  useEffect(() => {
    sharedRef.current = shared;
  }, [shared]);

  /* ---- 시나리오 로드 (로비 업로드 우선) ---- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const cached = localStorage.getItem(scenarioKey(code));
        if (cached) {
          const data = JSON.parse(cached);
          validateScenario(data);
          setScenario(data);
        } else {
          const res = await fetch("/scenario.json", { cache: "no-store" });
          const data: Scenario = await res.json();
          validateScenario(data);
          setScenario(data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  /* ---- Supabase 연결 ---- */
  useEffect(() => {
    if (!scenario) return;

    const channel = supabase.channel(`room-${code}`, { config: { presence: { key: role } } });
    channelRef.current = channel;

    // Presence: 접속자 목록 + 중복 P1 감지
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ name?: string }>>;

      // 1) 중복 P1 감지 → 경고 + 로비로 리디렉트
      const p1Count = state["P1"]?.length ?? 0;
      if (role === "P1" && p1Count > 1 && !redirectedRef.current) {
        redirectedRef.current = true;
        alert("⚠️ 이미 이 방에 플레이어1이 있습니다. 플레이어2로 입장해주세요!");
        router.replace(`/duo?room=${code}`);
        return;
      }

      // 2) 접속자 라벨 갱신(디바운스)
      const labels = Object.entries(state).map(([r, arr]) => {
        const n = arr[0]?.name?.trim();
        return n ? `${n}(${r})` : r;
        // 예: "지후(P1)", "민지(P2)"
      });
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => setPeers(labels), 200);
    });

    // 상태 수신
    channel.on("broadcast", { event: "state:update" }, ({ payload }) => {
      const incoming = payload as SharedState;
      setShared(prev => (!prev || incoming.version > prev.version ? incoming : prev));
    });

    // 상태 요청 → 최신 ref로 응답
    channel.on("broadcast", { event: "state:request" }, () => {
      const cur = sharedRef.current;
      if (cur) channel.send({ type: "broadcast", event: "state:update", payload: cur });
    });

    // 지문 로그 수신
    channel.on("broadcast", { event: "msg:add" }, ({ payload }) => {
      const m = payload as Message;
      setLogs(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m].sort((a, b) => a.ts - b.ts)));
    });
    channel.on("broadcast", { event: "msg:update" }, ({ payload }) => {
      const m = payload as Message;
      setLogs(prev => prev.map(x => (x.id === m.id ? { ...m, edited: true } : x)));
    });

    // 구독 시작
    channel.subscribe(async status => {
      if (status !== "SUBSCRIBED") return;
      await channel.track({ name: displayName, joinedAt: Date.now() });

      // P1은 초기화/재방송, P2는 상태 요청
      if (role === "P1") {
        if (!sharedRef.current) {
          const init: SharedState = { sceneId: scenario.start, vars: {}, turn: "P1", version: 1 };
          setShared(init);
          channel.send({ type: "broadcast", event: "state:update", payload: init });
        } else {
          channel.send({ type: "broadcast", event: "state:update", payload: sharedRef.current });
        }
      } else {
        channel.send({ type: "broadcast", event: "state:request", payload: { ask: role } });
      }
    });

    return () => {
      channel.unsubscribe();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [scenario, code, role, displayName, router]);

  /* ---- 파생 값 ---- */
  const currentScene = useMemo(
    () => scenario?.scenes.find(s => s.id === shared?.sceneId),
    [scenario, shared?.sceneId]
  );
  const isMyTurn = shared?.turn === role;

  /* ---- P2 기다리는 화면 (P1 전용) ---- */
  const bothPlayersConnected = peers.some(p => p.includes("(P1)")) && peers.some(p => p.includes("(P2)"));
  if (role === "P1" && !bothPlayersConnected) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <p className="text-lg text-gray-600">플레이어2가 입장할 때까지 기다리는 중…</p>
        <p className="text-sm text-gray-400 mt-2">방 코드: <span className="font-mono">{code}</span></p>
      </main>
    );
  }

  /* ---- 선택 → 지문 작성 ---- */
  function openComposer(c: Choice) {
    if (!isMyTurn) return;
    setComposerChoice(c);
    setComposerText("");
  }
  function cancelComposer() {
    setComposerChoice(null);
    setComposerText("");
  }
  function sendNarrativeAndAdvance() {
    if (!shared || !scenario || !composerChoice) return;
    const msg: Message = {
      id: genId(),
      role,
      name: displayName,
      sceneId: shared.sceneId,
      choiceText: composerChoice.text,
      text: composerText.trim(),
      ts: Date.now(),
    };
    if (msg.text) {
      setLogs(prev => [...prev, msg].sort((a, b) => a.ts - b.ts));
      channelRef.current?.send({ type: "broadcast", event: "msg:add", payload: msg });
    }

    const next: SharedState = {
      sceneId: composerChoice.next,
      vars: applyEffects(shared.vars, composerChoice.effects),
      turn: shared.turn === "P1" ? "P2" : "P1",
      version: shared.version + 1,
    };
    setShared(next);
    sharedRef.current = next;
    channelRef.current?.send({ type: "broadcast", event: "state:update", payload: next });
    cancelComposer();
  }

  /* ---- 메시지 수정 ---- */
  function startEditMessage(id: string) {
    setEditingId(id);
    const m = logs.find(x => x.id === id);
    setEditingText(m?.text ?? "");
  }
  function saveEditMessage() {
    if (!editingId) return;
    const original = logs.find(x => x.id === editingId);
    if (!original) return;
    const updated: Message = { ...original, text: editingText, edited: true };
    setLogs(prev => prev.map(x => (x.id === updated.id ? updated : x)));
    channelRef.current?.send({ type: "broadcast", event: "msg:update", payload: updated });
    setEditingId(null);
    setEditingText("");
  }

  /* ---- 로딩 게이트 ---- */
  if (loading || !scenario || !shared || !currentScene) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <p className="text-gray-500">방 연결 중…</p>
      </main>
    );
  }

  const isEnding = currentScene.kind === "ending";

  return (
    <main className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-3xl">
        {/* 헤더 */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">🧑‍🤝‍🧑 2인용 방</h1>
            <p className="text-gray-500 text-sm">
              코드: <span className="font-mono">{code}</span> · 내 역할: <b>{displayName}</b> · 접속:
              {peers.length ? ` ${peers.join(", ")}` : " 없음"}
            </p>
          </div>
          <Link href="/duo" className="text-blue-600 hover:underline">← 로비로</Link>
        </div>

        {/* 본문 */}
        <article className="rounded-2xl border p-6 bg-white shadow-sm mb-4">
          {isEnding ? (
            <>
              <h3 className="text-2xl font-bold mb-3">{(currentScene as any).title}</h3>
              {currentScene.body.map((line, i) => (
                <p key={i} className="mb-3 leading-relaxed">{line}</p>
              ))}
              <div className="mt-6">
                <button
                  className="px-4 py-2 rounded bg-gray-200"
                  onClick={() => {
                    const next: SharedState = {
                      sceneId: scenario.start,
                      vars: {},
                      turn: "P1",
                      version: (shared?.version ?? 0) + 1,
                    };
                    setShared(next);
                    sharedRef.current = next;
                    channelRef.current?.send({ type: "broadcast", event: "state:update", payload: next });
                  }}
                >
                  처음으로
                </button>
              </div>
            </>
          ) : (
            <>
              {currentScene.body.map((line, i) => (
                <p key={i} className="mb-3 leading-relaxed">{line}</p>
              ))}
              <div className="mt-6 grid gap-3">
                {(currentScene as any).choices.map((c: Choice, i: number) => (
                  <button
                    key={i}
                    onClick={() => openComposer(c)}
                    disabled={!isMyTurn}
                    className={`px-4 py-3 rounded-lg border text-left shadow-sm transition ${
                      isMyTurn
                        ? "border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-600"
                        : "border-gray-300 bg-gray-200 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    ➤ {c.text}
                  </button>
                ))}
              </div>
              {!isMyTurn && <p className="mt-3 text-sm text-gray-500">상대의 선택을 기다리는 중…</p>}

              {/* 지문 컴포저 (지문 없이 진행 버튼 제거됨) */}
              {isMyTurn && composerChoice && (
                <div className="mt-6 rounded-xl border p-4 bg-emerald-50 border-emerald-200">
                  <p className="font-medium mb-2">
                    선택: <span className="text-emerald-700">{composerChoice.text}</span>
                  </p>
                  <textarea
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    placeholder="여기에 지문/대사를 작성하세요."
                    rows={4}
                    className="w-full rounded border px-3 py-2"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      onClick={sendNarrativeAndAdvance}
                      disabled={!composerText.trim()}
                    >
                      보내고 진행
                    </button>
                    <button className="px-4 py-2 rounded border" onClick={cancelComposer}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </article>

        {/* 지문 로그 */}
        <section className="rounded-2xl border p-4 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">📝 지문 로그</h3>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-500">아직 지문이 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {logs.map((m) => {
                const isMine = m.role === role && m.name === displayName;
                const isEditing = editingId === m.id;
                return (
                  <li key={m.id} className="rounded-lg border p-3">
                    <div className="text-sm text-gray-500 mb-1">
                      <b>{m.name}</b> • {m.choiceText ? `선택: ${m.choiceText}` : "지문"} •{" "}
                      {new Date(m.ts).toLocaleTimeString()}
                      {m.edited ? " · 수정됨" : ""}
                    </div>
                    {!isEditing ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text || "(지문 없음)"}</p>
                    ) : (
                      <>
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={3}
                          className="w-full rounded border px-3 py-2"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            className="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={saveEditMessage}
                          >
                            저장
                          </button>
                          <button
                            className="px-3 py-1.5 rounded border"
                            onClick={() => setEditingId(null)}
                          >
                            취소
                          </button>
                        </div>
                      </>
                    )}
                    {isMine && !isEditing && (
                      <div className="mt-2">
                        <button
                          className="text-sm text-blue-600 hover:underline"
                          onClick={() => startEditMessage(m.id)}
                        >
                          수정
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
