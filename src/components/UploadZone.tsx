'use client';

import { useState, useRef, ChangeEvent, DragEvent } from 'react';

interface UploadZoneProps {
  onAnalyze: (file: File) => Promise<void>;
  isLoading: boolean;
}

export default function UploadZone({ onAnalyze, isLoading }: UploadZoneProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl]     = useState<string>('');
  const [isDragging, setIsDragging]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 선택할 수 있어요.');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const triggerCamera = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFileSelect(file);
    };
    input.click();
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      alert('사진을 먼저 선택해주세요.');
      return;
    }
    await onAnalyze(selectedFile);
  };

  const isReady = !!selectedFile && !isLoading;

  return (
    <div className="space-y-4">
      {/* ── 드래그앤드롭 업로드 영역 ── */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="rounded-2xl p-8 text-center cursor-pointer transition-all duration-200"
        style={{
          border: `2px dashed ${isDragging ? 'var(--primary)' : 'var(--border)'}`,
          background: isDragging ? 'var(--primary-soft)' : 'var(--surface)',
        }}
        aria-label="처방전 사진 업로드 영역"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {previewUrl ? (
          <div className="space-y-3">
            <img
              src={previewUrl}
              alt="선택한 처방전"
              className="max-w-full max-h-56 mx-auto rounded-xl object-contain"
            />
            <p className="text-base font-medium" style={{ color: 'var(--text-sub)' }}>
              다른 사진을 선택하려면 클릭하세요
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-4">
            <div className="text-5xl leading-none">📄</div>
            <p
              className="font-semibold"
              style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}
            >
              여기를 눌러 처방전 사진을 올려요
            </p>
            <p className="text-base" style={{ color: 'var(--text-sub)' }}>
              또는 사진을 여기로 끌어다 놓으세요
            </p>
          </div>
        )}
      </div>

      {/* ── 카메라 즉시 촬영 ── */}
      <button
        type="button"
        onClick={triggerCamera}
        className="btn-primary w-full text-white font-semibold rounded-xl active:scale-95"
        style={{
          height: '56px',
          fontSize: '1.1rem',
          background: 'var(--primary)',
        }}
        aria-label="카메라로 처방전 촬영"
      >
        📷 지금 바로 사진 찍기
      </button>

      {/* ── 분석 시작 버튼 ── */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isReady}
        className="btn-primary w-full text-white font-bold rounded-xl disabled:cursor-not-allowed active:scale-95"
        style={{
          height: '56px',
          fontSize: '1.1rem',
          background: isReady ? 'var(--primary)' : '#C8CCDB',
          opacity: isLoading ? 0.7 : 1,
        }}
        aria-label="처방전 분석 시작"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
            분석 중...
          </span>
        ) : '분석 시작하기'}
      </button>
    </div>
  );
}
