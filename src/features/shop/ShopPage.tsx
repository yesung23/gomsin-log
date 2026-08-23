import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookHeart,
  Palette,
  Sparkles,
  Info,
  Check,
  Smile,
} from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { MobileShell } from '@/components/MobileShell';
import { cn } from '@/lib/utils';

export type ShopCategory = 'all' | 'stickers' | 'themes' | 'books';

export interface ShopProduct {
  id: string;
  title: string;
  category: 'stickers' | 'themes' | 'books';
  categoryLabel: string;
  description: string;
  statusBadge: string;
  previewItems?: string[];
  highlights: string[];
}

const PRODUCTS: readonly ShopProduct[] = [
  {
    id: 'sticker-daily',
    title: '군화·곰신 일상 스티커 팩 (후보)',
    category: 'stickers',
    categoryLabel: '스티커',
    description: '훈련소, 전화 시간, 첫 휴가, 복귀날 등 우리만의 특별한 일상을 따뜻하게 남길 수 있는 다꾸 스티커 팩 구성안입니다.',
    statusBadge: '준비 중',
    previewItems: ['전화', '편지', '하트', '휴가'],
    highlights: ['손그림 감성 일러스트 구성안', '기록 지면에 자유롭게 배치', '기본 무료 스티커와 함께 사용 가능', '세부 구성은 출시 시 확정'],
  },
  {
    id: 'sticker-seasons',
    title: '사계절 감성 스티커 팩 (후보)',
    category: 'stickers',
    categoryLabel: '스티커',
    description: '봄 벚꽃, 여름 바다, 가을 낙엽, 겨울 눈꽃까지 계절의 흐름을 지면에 담을 수 있는 사계절 스티커 팩 구성안입니다.',
    statusBadge: '준비 중',
    previewItems: ['벚꽃', '파도', '단풍', '눈꽃'],
    highlights: ['사계절 대표 모티브 일러스트', '계절별 테마 다이어리에 최적화', '세부 구성은 출시 시 확정'],
  },
  {
    id: 'sticker-craft',
    title: '빈티지 마스킹 테이프 & 스탬프 (후보)',
    category: 'stickers',
    categoryLabel: '스티커',
    description: '크라프트 종이 테이프, 우표 스탬프, 포스트잇 느낌으로 손수 꾸민 듯한 감성을 더해주는 소품 스티커 팩 구성안입니다.',
    statusBadge: '준비 중',
    previewItems: ['테이프', '스탬프', '클립', '라벨'],
    highlights: ['종이 질감 오브젝트 에셋', '실제 다꾸 느낌의 스탬프 효과', '세부 구성은 출시 시 확정'],
  },
  {
    id: 'theme-kraft',
    title: '빈티지 크라프트지 테마 (미리보기)',
    category: 'themes',
    categoryLabel: '다꾸 테마',
    description: '따뜻하고 바스락거리는 크라프트 종이 질감과 잉크 펜 촉감이 어우러진 클래식 다이어리 테마 미리보기입니다.',
    statusBadge: '준비 중',
    highlights: ['크라프트 종이 질감 배경', '빈티지 잉크 컬러 팔레트', '손글씨 폰트 최적화'],
  },
  {
    id: 'theme-pastel',
    title: '파스텔 솜사탕 테마 (미리보기)',
    category: 'themes',
    categoryLabel: '다꾸 테마',
    description: '은은한 파스텔 톤 모눈 괘선과 부드러운 산호빛이 어우러져 화사하고 포근한 분위기를 주는 테마 미리보기입니다.',
    statusBadge: '준비 중',
    highlights: ['파스텔 그리드 괘선', '산호빛 포인트 컬러', '감성 일기장 스타일'],
  },
  {
    id: 'theme-minimal',
    title: '미니멀 흑백 노트 테마 (미리보기)',
    category: 'themes',
    categoryLabel: '다꾸 테마',
    description: '군더더기 없는 정갈한 흑백 잉크와 단정한 괘선으로 오직 기록의 문장에만 집중할 수 있는 테마 미리보기입니다.',
    statusBadge: '준비 중',
    highlights: ['단정한 모노크롬 괘선', '가독성 중심 레이아웃', '흑백 인쇄 감성'],
  },
  {
    id: 'book-monthly',
    title: '우리의 한 달 기억책 (상품 후보)',
    category: 'books',
    categoryLabel: '책 만들기',
    description: '한 달 동안 남긴 소중한 기록과 사진을 따로 정리할 필요 없이 앱이 한 권의 포토 에세이북으로 엮는 기억상품 미리보기입니다.',
    statusBadge: 'P-MP 게이트 대기',
    highlights: [
      '정리 부담 없는 자동 엮음 방향',
      '기록과 사진 중심 레이아웃',
      '제작 및 세부 사양은 P-MP 게이트 확정 후 결정',
    ],
  },
  {
    id: 'book-milestone',
    title: '100일 · 1주년 기념 앨범 (상품 후보)',
    category: 'books',
    categoryLabel: '책 만들기',
    description: '첫날부터 기념일까지 둘만의 특별한 마일스톤 순간들을 모아 소장할 수 있도록 기획 중인 기억상품 미리보기입니다.',
    statusBadge: 'P-MP 게이트 대기',
    highlights: [
      '마일스톤 중심 타임라인 하이라이트',
      '기념일 맞춤 앨범 기획안',
      '제작 방식 및 사양은 추후 확정',
    ],
  },
] as const;

const CATEGORIES: readonly { key: ShopCategory; label: string; icon: typeof Sparkles }[] = [
  { key: 'all', label: '전체', icon: Sparkles },
  { key: 'stickers', label: '스티커', icon: Smile },
  { key: 'themes', label: '다꾸 테마', icon: Palette },
  { key: 'books', label: '책 만들기', icon: BookHeart },
] as const;

export function ShopPageBody() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('all');

  const filteredProducts = selectedCategory === 'all'
    ? PRODUCTS
    : PRODUCTS.filter((p) => p.category === selectedCategory);

  return (
    <div className="min-h-full pb-24">
      <AppBar
        title="다꾸 상점"
        onBack={() => navigate('/diary')}
        backLabel="일기장으로 돌아가기"
      />

      <div className="px-4 py-4 space-y-4">
        {/* 안내 카드 */}
        <section
          aria-label="상점 상태 안내"
          className="rounded-surface border border-border bg-card p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <Info size={16} className="text-coral shrink-0" aria-hidden="true" />
            <h2 className="text-label font-bold text-card-foreground">
              아직 결제를 열지 않았어요 · 준비 중
            </h2>
          </div>
          <p className="text-caption text-muted-foreground leading-relaxed">
            기본 스티커 12종은 일기장 지면에서 언제든 무료로 사용할 수 있어요. 유료 스티커 팩,
            다꾸 테마, 실물 책 만들기(Memory Product)는 결제 및 제작 파이프라인 준비가 완료된 후
            순차적으로 오픈됩니다.
          </p>
          <p className="text-caption text-muted-foreground leading-relaxed">
            가격은 임의의 값이 아닌 정식 기억상품 정책 확정 후 정직하게 안내해 드릴게요.
          </p>
        </section>

        {/* 카테고리 탭바 */}
        <div
          role="tablist"
          aria-label="상품 카테고리"
          className="flex gap-1.5 overflow-x-auto pb-1"
        >
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.key;
            const Icon = cat.icon;
            return (
              <button
                key={cat.key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={cat.label}
                onClick={() => setSelectedCategory(cat.key)}
                className={cn(
                  'press-response shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-control text-label transition-colors',
                  active
                    ? 'bg-foreground text-background font-bold'
                    : 'bg-card border border-border text-muted-foreground',
                )}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* 상품 카드 목록 */}
        <div className="space-y-3.5" role="region" aria-label="상품 목록">
          {filteredProducts.map((product) => (
            <article
              key={product.id}
              className="rounded-surface border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {product.categoryLabel}
                    </span>
                    <span className="text-caption font-semibold px-2 py-0.5 rounded bg-coral/10 text-coral">
                      {product.statusBadge}
                    </span>
                  </div>
                  <h3 className="text-heading text-card-foreground">{product.title}</h3>
                </div>
                {product.category === 'stickers' && (
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <Smile size={20} aria-hidden="true" />
                  </div>
                )}
                {product.category === 'themes' && (
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <Palette size={20} aria-hidden="true" />
                  </div>
                )}
                {product.category === 'books' && (
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <BookHeart size={20} aria-hidden="true" />
                  </div>
                )}
              </div>

              <p className="text-body text-card-foreground leading-relaxed">
                {product.description}
              </p>

              {product.previewItems && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {product.previewItems.map((item) => (
                    <span
                      key={item}
                      className="text-caption px-2 py-1 rounded bg-muted/80 text-foreground"
                    >
                      {'#' + item}
                    </span>
                  ))}
                </div>
              )}

              <ul className="space-y-1 pt-1">
                {product.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <Check size={12} className="text-coral shrink-0" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-caption text-muted-foreground">
                  결제 및 구매 준비 중
                </span>
                <button
                  type="button"
                  disabled
                  aria-label={product.title + ' 준비 중'}
                  className="px-3 py-1.5 rounded-control text-caption font-semibold bg-muted text-muted-foreground cursor-not-allowed opacity-80"
                >
                  준비 중
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShopPage() {
  return (
    <MobileShell>
      <ShopPageBody />
    </MobileShell>
  );
}
