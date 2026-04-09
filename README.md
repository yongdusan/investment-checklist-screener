# 투자 체크리스트 스크리너

메리츠 투자기에서 읽을 수 있는 재현 가능한 투자 원칙을 간단한 점수 모델로 옮긴 정적 웹 도구입니다.

## 무엇을 하는 도구인가

- 종목 유니버스를 한 번에 넣고 상위 후보를 자동 선별합니다.
- `저평가`, `수익성`, `재평가 계기`, `재무 안정성`, `설명의 단순성`, `확신도`를 점수화합니다.
- 점수가 높은 순으로 후보를 정렬하고, 상위 몇 개 종목만 바로 보여줍니다.
- CSV URL이 있으면 외부 유니버스를 바로 불러올 수 있습니다.

## 실행 방법

브라우저에서 `/Users/ahn-yongsung/Project/investment-checklist-screener/index.html` 파일을 열면 됩니다.

## GitHub Actions 서버 자동화

이 프로젝트에는 GitHub Actions 워크플로 예시가 포함되어 있습니다:

- [daily-report.yml](/Users/ahn-yongsung/Project/investment-checklist-screener/.github/workflows/daily-report.yml)

동작 순서:

1. OpenDART 유니버스 생성
2. KRX CSV가 저장소에 있으면 병합
3. Markdown 리포트 생성
4. Notion 데이터베이스에 새 페이지 생성

필요한 GitHub Secrets:

- `OPENDART_API_KEY`
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID`
- 선택값: `REPORT_MIN_SCORE`, `REPORT_TOP_N`, `NOTION_STATUS`

현재 스케줄은 `30 23 * * 0-4` 로 설정되어 있습니다. 이는 한국시간 기준 평일 오전 8시 30분에 해당합니다.

로컬에서 테스트할 때는 [.env.example](/Users/ahn-yongsung/Project/investment-checklist-screener/.env.example) 를 참고해 `.env`를 만들면 됩니다.

## 자동 유니버스 생성

OpenDART API 키가 있으면 간단한 정량 유니버스를 만들 수 있습니다.

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
OPENDART_API_KEY=발급받은키 node ./scripts/build-dart-universe.mjs 2025 120 ./data/universe.latest.csv
```

- 첫 번째 인자: 사업연도
- 두 번째 인자: 최대 몇 개 회사를 조회할지. 생략하면 전체 상장사를 대상으로 시도합니다.
- 세 번째 인자: 출력 CSV 경로

생성된 파일은 화면의 `로컬 CSV 파일` 입력으로 바로 열 수 있습니다.

전체 시장을 기준으로 뽑고 싶다면 이렇게 실행하면 됩니다.

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
OPENDART_API_KEY=발급받은키 node ./scripts/build-dart-universe.mjs 2025
```

## KRX 내보내기 병합

KRX 정보데이터시스템에서 공식 CSV를 내려받아 DART 유니버스와 합칠 수 있습니다.

필요한 KRX 파일 예시:

1. 전종목 기본정보
2. 전종목 PER/PBR/배당수익률
3. 자기주식 제외 시가총액 또는 전종목 시가총액

병합 명령:

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
node ./scripts/merge-krx-exports.mjs \
  ./data/universe.latest.csv \
  ./data/krx-basic.csv \
  ./data/krx-valuation.csv \
  ./data/krx-marketcap.csv \
  ./data/universe.enriched.csv
```

생성된 `universe.enriched.csv`를 화면에 넣으면 `시장`, `업종`, `시가총액`, `PER`, `PBR`, `배당수익률`까지 반영된 후보 리스트를 볼 수 있습니다.

## 일간 리포트 생성

병합된 유니버스 CSV에서 매일 읽을 수 있는 후보 리포트를 만들 수 있습니다.

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
node ./scripts/generate-daily-report.mjs \
  ./data/universe.enriched.csv \
  ./reports/daily-shortlist.md \
  60 \
  10
```

- 첫 번째 인자: 입력 CSV
- 두 번째 인자: 출력 마크다운 파일
- 세 번째 인자: 최소 점수
- 네 번째 인자: 상위 후보 수

CSV에 `market`, `sector`, `marketCap`, `per`, `pbr`가 들어 있을수록 리포트 품질이 좋아집니다.

## Notion 업로드

생성된 Markdown 리포트를 Notion 데이터베이스에 새 페이지로 올릴 수 있습니다.

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
NOTION_API_KEY=발급받은키 \
NOTION_DATABASE_ID=33d0ad6fdb0d80af9968e069afe6ca1b \
node ./scripts/publish-to-notion.mjs \
  ./reports/daily-shortlist.md \
  2026-04-10 \
  60 \
  10 \
  ./data/universe.enriched.csv \
  생성중
```

리포트 본문은 제목, 요약, 점수표, 상세 후보 섹션을 Notion 블록으로 변환해 업로드합니다.

## 서버 파이프라인 한 번에 실행

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
OPENDART_API_KEY=발급받은키 \
NOTION_API_KEY=발급받은키 \
NOTION_DATABASE_ID=33d0ad6fdb0d80af9968e069afe6ca1b \
node ./scripts/run-daily-pipeline.mjs
```

이 스크립트는 DART 수집, KRX 병합, 리포트 생성, Notion 업로드를 순서대로 실행합니다.

## 추천 사용 흐름

1. 한국주식 또는 관심 유니버스 CSV를 준비합니다.
2. `URL 불러오기` 또는 아래 텍스트 영역에 붙여넣습니다.
3. 최소 점수, 촉매 필터, 확신도 필터, 상위 종목 수를 조정합니다.
4. 상위 후보만 먼저 읽고, 통과 이유와 정보 충실도를 확인합니다.

## CSV 형식

```csv
name,market,sector,marketCap,per,roe,pbr,debtRatio,opMargin,dividendYield,netCash,catalyst,governance,confidence
메리츠금융지주,KOSPI,금융,21000000000000,6.2,24.5,1.35,82,28,5.2,true,strong,strong,high
```

## 입력 규칙

- `netCash`: `true` 또는 `false`
- `catalyst`: `strong`, `medium`, `weak`
- `governance`: `strong`, `medium`, `weak`
- `confidence`: `high`, `medium`, `low`
- `marketCap`: 원 단위 숫자
- `dividendYield`: 숫자

## 자동 수집에서 채워지는 값

- OpenDART 스크립트는 현재 `ROE`, `영업이익률`, `부채비율` 중심의 정량 데이터만 채웁니다.
- `촉매`, `거버넌스`, `확신도`는 일부만 약하게 추정하거나 비워둡니다.
- 그래서 자동 추천은 1차 후보 압축용으로 쓰고, 최종 판단 전에 정성 검토가 꼭 필요합니다.
- KRX CSV를 병합하면 `시장`, `업종`, `시가총액`, `PER`, `PBR`, `배당수익률`까지 자동 보강할 수 있습니다.

## 주의

이 도구는 아이디어를 정리하는 보조 도구입니다. 실제 투자 전에는 공시, 실적, 산업 구조, 대주주 행동, 자본 배치 이력까지 별도로 확인해야 합니다.

## 참고한 공식 화면

- [KRX Data Marketplace 메인](https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd)
- [주식 전종목/기본정보 계열 화면](https://data.krx.co.kr/contents/MMC/ISIF/isif/MMCISIF003.cmd?tabIndex=0)
- [주식 전종목/PER PBR 계열 화면](https://data.krx.co.kr/contents/MMC/ISIF/isif/MMCISIF003.cmd?tabIndex=1)
