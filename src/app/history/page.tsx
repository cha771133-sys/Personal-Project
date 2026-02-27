'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getHistoryList,
  deleteHistory,
  formatSavedAt,
  type PrescriptionHistory,
} from '@/lib/historyStorage';
import PillBadge from '@/components/PillBadge';
import BottomNav from '@/components/BottomNav';
import type { AnalyzeResponse } from '@/types/prescription';

export default function HistoryPage() {
  const router = useRouter();
  const [list, setList] = useState<PrescriptionHistory[]>([]);

  useEffect(() => {
    setList(getHistoryList());
  }, []);

  const handleDelete = (id: string) => {
    if (!window.confirm('이 처방전 기록을 삭제할까요?')) return;
    deleteHistory(id);
    setList(getHistoryList());
  };

  const handleReuse = (history: PrescriptionHistory) => {
    // 해당 히스토리를 result 페이지에서 볼 수 있도록 sessionStorage에 주입
    const fakeResponse: AnalyzeResponse = {
      status: 'success',
      message: '저장된 처방전을 불러왔어요.',
      data: {
        hospital: history.hospitalName,
        medications: history.medications,
        general_warnings: [],
        ocr_confidence: 'high',
      },
    };
    sessionStorage.setItem('yaksouk_result', JSON.stringify(fakeResponse));
    router.push('/result');
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] pb-28">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-12 h-12 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 text-xl"
            aria-label="뒤로가기"
          >
            ←
          </button>
          <h1 className="text-3xl font-black text-gray-900">📋 처방전 기록</h1>
        </div>

        {/* 기록 없을 때 */}
        {list.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center space-y-3 shadow-sm">
            <p className="text-5xl">💊</p>
            <p className="text-xl font-semibold text-gray-600">
              아직 저장된 처방전이 없어요 😊
            </p>
            <p className="text-lg text-gray-400">
              처방전을 분석하면 자동으로 여기에 저장돼요
            </p>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="mt-4 px-6 py-4 bg-blue-700 text-white text-lg font-bold rounded-2xl hover:bg-blue-800 transition-colors"
            >
              처방전 분석하러 가기
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-lg text-gray-500 px-1">총 {list.length}건</p>
            {list.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4"
              >
                {/* 날짜 + 병원 */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base text-gray-400 font-medium">
                      {formatSavedAt(item.savedAt)}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-0.5">
                      🏥 {item.hospitalName}
                    </p>
                    <p className="text-lg text-gray-500 mt-1">
                      약 {item.medications.length}가지
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="flex-shrink-0 px-3 py-2 text-sm font-semibold text-red-500 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
                    aria-label="기록 삭제"
                  >
                    삭제
                  </button>
                </div>

                {/* 알약 뱃지 목록 */}
                <div className="flex flex-wrap gap-3 items-center">
                  {item.medications.map((med, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <PillBadge
                        color={med.pill_color || '#C8C8C8'}
                        shape={med.pill_shape || 'tablet'}
                        size="sm"
                      />
                      <span className="text-sm text-gray-600 font-medium">
                        {med.drug_name_simple}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 다시 알림 등록 버튼 */}
                <button
                  type="button"
                  onClick={() => handleReuse(item)}
                  className="w-full py-4 bg-blue-700 text-white text-lg font-bold rounded-2xl hover:bg-blue-800 transition-colors active:scale-95"
                >
                  🔔 다시 알림 등록하기
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
