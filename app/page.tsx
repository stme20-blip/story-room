"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-bold mb-2">🎭 텍스트 스토리 플레이</h1>
        <p className="text-gray-600 mb-8">읽고, 선택하고, 함께 이야기해요.</p>

        <div className="grid gap-4">
          <Link
            href="/solo"
            className="block px-6 py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 shadow-sm"
          >
            1인용 시나리오 플레이 (솔로)
          </Link>
          <Link
            href="/duo"
            className="block px-6 py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 shadow-sm"
          >
            2인용 시나리오 플레이 (코드 생성)
          </Link>
        </div>

        <div className="mt-8 text-sm text-gray-500">
          <p>⚙️ 업로드·에디터 기능은 1인용 메뉴 내부에서 사용 가능</p>
          <p>🧑‍🤝‍🧑 2인용은 방 코드로 함께 접속 (다음 단계에서 실시간 연결)</p>
        </div>
      </div>
    </main>
  );
}