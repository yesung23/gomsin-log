#!/usr/bin/env python3
"""
손글씨 웹폰트를 빈도순 unicode-range 슬라이스로 자르고, CSS와 실측표를 낸다.

    python3 scripts/fonts/build_hand_font.py <원본.ttf> <출력디렉터리>

산출: <출력>/hand-<n>.woff2 · <출력>/hand.css · 표준출력에 실측표

필요: fonttools + brotli  (개발 도구이며 앱 의존성이 아니다)
    python3 -m venv .fontenv && .fontenv/bin/pip install fonttools brotli

## 슬라이스 경계를 이렇게 잡은 이유

`hangul_frequency.py`로 잰 커버리지가 근거다. 상위 300자가 일상 문장의 82.5%,
500자가 97.6%를 덮는다. 그래서 slice 0에 상위 300을 넣어 대부분의 화면이 슬라이스
하나로 끝나게 하고, 그다음 300으로 사실상 전부를 덮는다. 나머지는 드물게 쓰이므로
큰 덩어리로 묶어도 평균 비용에 거의 영향이 없다.

한글이 아닌 것(라틴·숫자·문장부호·자모)은 slice 0에만 넣는다. 매 슬라이스에 중복해서
넣으면 슬라이스 수만큼 곱해진다.
"""
import subprocess, sys, os, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from hangul_frequency import main as frequency

# 한 슬라이스에 담는 한글 음절 수. 균일하게 자른다.
#
# 크기를 바꿔 가며 실측한 결과다(첫 화면에 실제로 내려오는 양):
#
#     300자 / 38개   →  132 kB
#     150자 / 75개   →  135 kB
#     100자 / 112개  →   99–118 kB
#      60자 / 187개  →   81–105 kB   ← 채택
#      40자 / 280개  →   70–95 kB    (이득이 꺾인다)
#
# 300자 슬라이스가 가장 나쁜 이유는 직관과 반대다. 한 화면이 쓰는 고유 음절이 50개여도
# 그 50개가 순위 0–600에 흩어져 있으면 큰 슬라이스를 두세 개 통째로 끌어온다. 잘게 자를수록
# 실제로 쓰는 글리프만 내려온다.
#
# 부수 효과 하나가 중요하다: **잘게 자르면 빈도 정렬의 품질이 덜 중요해진다.** 순위가 조금
# 틀려도 필요한 슬라이스만 오기 때문이다. 코퍼스가 완벽하지 않아도 되는 이유다.
SLICE = 60
BASE_RANGES = [
    (0x0020, 0x007E),   # 라틴 · 숫자 · 기본 문장부호
    (0x00A0, 0x00A0),
    (0x1100, 0x11FF),   # 한글 자모 (조합형 입력 중간 상태)
    (0x3000, 0x303F),   # 한국어 문장부호
    (0x3130, 0x318F),   # 호환 자모
    (0xFF01, 0xFF5E),   # 전각
    (0x2018, 0x201D),   # 따옴표
    (0x2026, 0x2026),   # …
    (0x2013, 0x2014),   # – —
]

def ranges_of(chars):
    """연속한 코드포인트를 U+XXXX-YYYY로 묶어 CSS unicode-range 문자열을 만든다."""
    cps = sorted(ord(c) for c in chars)
    out, start, prev = [], None, None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append((start, prev)); start = prev = cp
    if start is not None:
        out.append((start, prev))
    return out

def fmt(ranges):
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in ranges)

def build(src, outdir):
    ordered, tail, counts, every = frequency('.')
    allsyl = ordered + tail
    groups = [allsyl[i:i + SLICE] for i in range(0, len(allsyl), SLICE)]

    outdir = pathlib.Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    css, rows = [], []
    for i, group in enumerate(groups):
        if not group: continue
        rngs = ranges_of(group)
        if i == 0: rngs = BASE_RANGES + rngs
        out = outdir / f'hand-{i}.woff2'
        # `--layout-features=` 는 비운다. 이 폰트에서 `*` 와 크기가 같았고(실측 203.2 kB로
        # 동일), 손글씨 한글에 필요한 GSUB/GPOS 기능이 없다.
        cmd = ['pyftsubset', src, f'--output-file={out}', '--flavor=woff2',
               '--layout-features=', '--no-hinting', '--desubroutinize',
               '--drop-tables+=FFTM', '--unicodes=' + fmt(rngs).replace(' ', '')]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f'slice {i} FAILED\n{r.stderr[-400:]}'); return
        kb = out.stat().st_size / 1024
        rows.append((i, len(group), kb, rngs))
        css.append('@font-face{\n'
                   '  font-family:"Gomsin Hand";\n  font-style:normal;\n'
                   '  font-weight:400;\n  font-display:swap;\n'
                   '  size-adjust:120%;\n'
                   f'  src:url("./hand-{i}.woff2") format("woff2");\n'
                   f'  unicode-range:{fmt(rngs)};\n}}')
    (outdir / 'hand.css').write_text('\n'.join(css) + '\n', encoding='utf-8')

    total = sum(kb for _, _, kb, _ in rows)
    print(f'슬라이스 {len(rows)}개 · 전체 합계 {total:,.0f} kB '
          f'(전부 내려오는 일은 없다 — 아래 시뮬레이션 참조)')
    print(f'  hand-0 {rows[0][2]:.1f} kB — 라틴·숫자·문장부호·자모 포함, 항상 필요')
    print(f'  나머지 평균 {(total - rows[0][2]) / max(len(rows) - 1, 1):.1f} kB')
    print(f"CSS: {outdir/'hand.css'}")
    return rows, groups

def simulate(rows, groups, label, text):
    """이 텍스트를 그리려면 어떤 슬라이스가 내려오고 합계가 얼마인가."""
    need, uniq = set(), set(c for c in text if '가' <= c <= '힣')
    index = {}
    for gi, g in enumerate(groups):
        for c in g: index[c] = gi
    for c in uniq: need.add(index.get(c, len(groups) - 1))
    need.add(0)  # 라틴·문장부호 때문에 항상 필요하다
    total = sum(kb for i, _, kb, _ in rows if i in need)
    print(f'  {label:<26} 고유 {len(uniq):>4}자 · 슬라이스 {sorted(need)} → {total:>6.1f} kB')

if __name__ == '__main__':
    src, outdir = sys.argv[1], sys.argv[2]
    rows, groups = build(src, outdir)
    print('\n실제 화면 시뮬레이션 — 이 텍스트를 그리는 데 내려오는 양')
    simulate(rows, groups, '홈 (편지 카드 + 포스트 3)',
        '오전에는 시험 때문에 속상했어요 점심에는 친구와 밥을 먹었어요 오후에는 좋은 일이 있었어요 '
        '오늘 시험 끝났어 생각보다 잘 봤어 밥 먹었어 보고 싶다 다음 주에 면회 갈게 그때까지 힘내자')
    simulate(rows, groups, '스토리 한 장',
        '오늘은 좀 지쳤어 컨디션이 안 좋아 그래도 하루 남겨 둘게 잘 자 내일 또 얘기하자')
    simulate(rows, groups, '긴 기록 (400자)',
        '아침에 일어나서 학교에 갔어 점심은 친구랑 같이 먹었고 오후에는 도서관에서 공부했어 '
        '시험이 다음 주라서 요즘 계속 도서관에 있어 힘들지만 그래도 할 만해 '
        '어제는 엄마가 반찬을 보내주셨는데 네가 좋아하던 그 김치도 있었어 '
        '휴가 나오면 같이 먹자 그때 바다도 보러 가고 사진도 많이 찍자 '
        '전역까지 얼마 안 남았다고 생각하면 신기해 우리 진짜 오래 기다렸다 '
        '조금만 더 버티자 사랑해 잘 자 좋은 꿈 꿔')
