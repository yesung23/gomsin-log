#!/usr/bin/env python3
"""
손글씨 웹폰트를 빈도순 unicode-range 슬라이스로 자르기 위한 음절 빈도표를 만든다.

## 왜 빈도순이어야 하는가

한 문장의 한글 음절은 U+AC00–D7A3 전 구간에 흩어진다. 코드포인트 순서로 100자씩 자르면
짧은 글 하나가 수십 개 슬라이스를 끌어와 오히려 더 무겁다. 그래서 자주 쓰는 음절이 앞
슬라이스에 모이도록 빈도로 정렬한다. Google Fonts의 한국어 배포본이 쓰는 방식과 같다.

## 코퍼스

둘을 합친다.

  1. 저장소의 한국어 문서(docs/**.md) — 실제로 쓰이는 한국어 산문이지만 기술 어휘로
     치우쳐 있다. `마이그레이션`·`검증`·`계약` 같은 음절이 과대평가된다.
  2. 아래 EVERYDAY 샘플 — 이 앱에 실제로 쓰일 일상 문장.

순위의 주인은 2번이다. 1번은 그 뒤를 채운다. 이유는 `main()`의 주석에 있다.

고빈도 구간은 조사·어미(이·는·을·하·다·에·서·고·지·어)가 지배하므로 두 코퍼스가 크게
다르지 않다. 차이는 꼬리에서 나며, 꼬리는 어느 슬라이스에 들어가든 비용이 같다.

실사용 로그로 다시 만들 수 있다면 그렇게 한다. 다만 사용자 기록은 E2EE 대상이므로
그 코퍼스는 절대 서버에서 만들지 않는다.
"""
import sys, re, collections, pathlib

EVERYDAY = """
오늘 하루도 고생했어 밥은 먹었어 뭐 하고 있어 보고 싶다 사랑해 잘 자 좋은 꿈 꿔
아침에 일어나서 학교에 갔어 점심은 친구랑 같이 먹었고 오후에는 도서관에서 공부했어
시험 끝나서 기분이 좋아 생각보다 잘 본 것 같아 이번 주는 좀 힘들었어 피곤하다
날씨가 추워졌어 감기 조심해 옷 따뜻하게 입어 아프지 마 건강 챙겨
다음 주에 면회 갈게 그때까지 힘내자 얼마 안 남았다 곧 만나자 기다릴게
휴가 나오면 같이 가고 싶은 데가 있어 바다 보러 가자 맛있는 거 먹자 영화도 보고
사진 찍어서 보내줄게 이거 봐 봐 예쁘지 우리 같이 갔던 데야 기억나
전화 언제 할 수 있어 시간 될 때 알려줘 목소리 듣고 싶어 통화하자
엄마가 반찬 보내주셨어 강아지가 아프대 걱정된다 별일 없지 무슨 일 있어
오늘은 좀 지쳤어 컨디션이 안 좋아 그냥 쉬고 싶다 아무것도 하기 싫어 그래도 괜찮아
고마워 미안해 화 안 났어 내 마음 알지 항상 응원해 늘 고맙게 생각해
어제 꿈에 네가 나왔어 웃겼어 진짜 웃겨 재밌다 신기해 대박 헐 그러게 맞아 그치
백일이야 벌써 일 년이 됐네 시간 참 빠르다 우리 처음 만난 날 기억나
전역까지 얼마 안 남았어 조금만 더 버티자 우리 잘하고 있어 힘든 건 지나가
운동했어 책 읽었어 음악 들었어 청소했어 빨래했어 장 보러 갔다 왔어
버스 놓쳐서 늦었어 지하철이 사람 많았어 비 와서 우산 챙겼어 눈이 왔어
언니랑 통화했어 동생이 놀러 왔어 아빠가 데리러 오셨어 할머니 댁에 다녀왔어
"""

def hangul_counts(text):
    return collections.Counter(c for c in text if '가' <= c <= '힣')

def main(root='.'):
    counts = collections.Counter()
    docs = sorted(pathlib.Path(root, 'docs').rglob('*.md'))
    for f in docs:
        try:
            counts.update(hangul_counts(f.read_text(encoding='utf-8')))
        except Exception:
            pass
    for f in sorted(pathlib.Path(root, 'src').rglob('*.tsx')) + sorted(pathlib.Path(root, 'src').rglob('*.ts')):
        try:
            counts.update(hangul_counts(f.read_text(encoding='utf-8')))
        except Exception:
            pass
    every = hangul_counts(EVERYDAY)

    # 일상 문장에 나오는 음절을 먼저, 그 안에서 빈도순으로 놓는다.
    #
    # 가중치를 주어 하나의 순위로 합치는 것은 처음에 시도했다가 버렸다. 저장소 문서가
    # 32만 회로 압도적이라, 가중치를 아무리 올려도 `잤`·`꿔`·`쳤` 같은 일상 음절이
    # 300위 밖으로 밀렸다. 그 결과 짧은 스토리 한 장조차 slice 1을 끌어와서, 슬라이스를
    # 나눈 의미가 없어졌다(측정: 어떤 화면이든 131.7 kB).
    #
    # 손글씨가 적용되는 곳은 UI가 아니라 **사용자가 쓴 글**뿐이므로(§4.1 규칙 1),
    # 순위의 주인은 일상 문장이어야 한다. 문서 코퍼스는 그 뒤를 채운다.
    ordered = [ch for ch, _ in every.most_common()]
    seen_e = set(ordered)
    ordered += [ch for ch, _ in counts.most_common() if ch not in seen_e]
    # 코퍼스에 없는 나머지 완성형은 코드포인트 순서로 꼬리에 붙인다.
    seen = set(ordered)
    tail = [chr(cp) for cp in range(0xAC00, 0xD7A4) if chr(cp) not in seen]
    return ordered, tail, counts, every

if __name__ == '__main__':
    ordered, tail, counts, every = main(sys.argv[1] if len(sys.argv) > 1 else '.')
    total = sum(counts.values())
    print(f"코퍼스 음절 출현 {total:,}회 · 고유 음절 {len(ordered):,}자 · 미출현 {len(tail):,}자")
    for n in (100, 200, 300, 500, 800, 1200, 2000):
        cover = sum(c for _, c in counts.most_common(n)) / total * 100
        # 일상 샘플만으로 다시 재본 커버리지 (기술 편향 제거)
        head = set(ch for ch, _ in counts.most_common(n))
        ecov = sum(c for ch, c in every.items() if ch in head) / sum(every.values()) * 100
        print(f"  상위 {n:>5}자 → 전체 {cover:5.1f}% · 일상문장 {ecov:5.1f}%")
    print("상위 60자:", ''.join(ordered[:60]))
