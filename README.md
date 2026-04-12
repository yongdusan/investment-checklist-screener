# 투자 체크리스트 스크리너

메리츠 투자기에서 읽을 수 있는 재현 가능한 투자 원칙을 간단한 점수 모델로 옮긴 정적 웹 도구입니다.

## 무엇을 하는 도구인가

- 종목 유니버스를 한 번에 넣고 상위 후보를 자동 선별합니다.
- `상대 저평가`, `수익성`, `재평가 계기`, `재무 안정성`, `주주환원`, `설명의 단순성`, `확신도`를 점수화합니다.
- 점수가 높은 순으로 후보를 정렬하고, 상위 몇 개 종목만 바로 보여줍니다.
- CSV URL이 있으면 외부 유니버스를 바로 불러올 수 있습니다.
- 항목별 점수 breakdown과 리포트 히스토리 인덱스를 함께 만듭니다.

## 실행 방법

브라우저에서 `/Users/ahn-yongsung/Project/investment-checklist-screener/index.html` 파일을 열면 됩니다.

## GitHub Actions 서버 자동화

이 프로젝트에는 두 개의 GitHub Actions 워크플로가 포함되어 있습니다:

- [daily-report.yml](/Users/ahn-yongsung/Project/investment-checklist-screener/.github/workflows/daily-report.yml)
- [refresh-universe.yml](/Users/ahn-yongsung/Project/investment-checklist-screener/.github/workflows/refresh-universe.yml)

`Daily Stock Report` 동작 순서:

1. 기존 `data/universe.enriched.csv` 또는 `data/universe.latest.csv` 확인
2. Markdown 리포트 생성
3. `reports/index.md` 히스토리 갱신
4. 생성된 리포트를 저장소에 자동 커밋

`Refresh Stock Universe` 동작 순서:

1. KRX 기본정보 CSV로 수집 대상 종목을 결정
2. OpenDART 유니버스 생성
3. KRX CSV가 저장소에 있으면 병합
3. Markdown 리포트 생성
4. `reports/index.md` 히스토리 갱신
5. 생성된 리포트와 CSV를 저장소에 자동 커밋

필요한 GitHub Secrets:

- `OPENDART_API_KEY`

기본 설정은 [reporting.mjs](/Users/ahn-yongsung/Project/investment-checklist-screener/config/reporting.mjs) 에서 관리합니다.

- 기본 최소 점수: `60`
- 기본 상위 후보 수: `10`
- 기본 기준연도: 현재 연도 - 1

환경변수 `REPORT_MIN_SCORE`, `REPORT_TOP_N`, `REPORT_YEAR`, `REPORT_LIMIT` 를 주면 일시적으로 덮어쓸 수 있습니다.

기본 `REPORT_LIMIT` 은 `100`입니다. 전체 상장사를 한 번에 조회하면 OpenDART 호출 수가 과도해져 워크플로가 오래 걸릴 수 있어서, MVP 단계에서는 제한된 유니버스를 먼저 안정적으로 갱신하는 구조를 권장합니다.

중요:
- `Refresh Stock Universe`는 이제 `data/krx-basic.csv`를 필수 입력으로 사용합니다.
- 즉 KRX 기본정보 CSV가 저장소에 없으면 refresh 워크플로는 명확히 실패합니다.
- 이유는 OpenDART `corpCode.xml` 앞부분만으로 표본을 고르면 스팩, 리츠, 특수목적 법인이 과도하게 섞여 실질 유니버스를 만들기 어려웠기 때문입니다.

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

생성된 `universe.enriched.csv`를 화면에 넣으면 `시장`, `업종`, `시가총액`, `PER`, `PBR`, `EV/EBITDA`, `FCF Yield`, `배당수익률`과 함께 `ROIC`, `3년 추세`, `이자보상배율`, `현금전환율`까지 반영된 후보 리스트를 볼 수 있습니다.

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

리포트에는 다음이 함께 들어갑니다.

- 점수표
- 종목별 항목 점수 breakdown
- 후보가 0개일 때의 보류 사유
- `reports/index.md` 히스토리 목록
- 수동 오버레이 반영 종목 수
- 자동/수동 데이터 출처 구분
- 직전 리포트 대비 순위/점수 변화
- 비정상 재무비율 필터링

## 수동 오버레이

`재평가 계기`, `거버넌스`, `주주환원`, `확신도` 같은 정성 항목은 자동 수집만으로 채우기 어렵습니다. 그래서 이 프로젝트는 [manual-overrides.csv](/Users/ahn-yongsung/Project/investment-checklist-screener/data/manual-overrides.csv) 를 함께 읽도록 되어 있습니다.

기본 위치:

- [manual-overrides.csv](/Users/ahn-yongsung/Project/investment-checklist-screener/data/manual-overrides.csv)

기본 형식:

```csv
stockCode,name,catalyst,governance,confidence,shareholderReturn,netCash,market,sector,valueUp,buyback,treasuryCancellation,payoutRaise,assetSale,spinOff,insiderBuying,foreignOwnershipRebound,coverageInitiation,note
005930,삼성전자,strong,medium,high,strong,,KOSPI,전기전자,true,true,true,true,false,false,false,true,true,반도체 업황 회복과 주주환원 정책을 계속 추적
035420,NAVER,medium,,medium,medium,,KOSPI,서비스업,false,false,false,false,false,false,false,false,true,광고/커머스 수익성 회복 여부 계속 체크
```

지원 필드:

- `stockCode`: 6자리 종목코드 기준 우선 매칭
- `name`: 종목명 기준 보조 매칭
- `catalyst`: `strong`, `medium`, `weak`
- `governance`: `strong`, `medium`, `weak`
- `confidence`: `high`, `medium`, `low`
- `shareholderReturn`: `strong`, `medium`, `weak`
- `netCash`: `true`, `false`
- `market`: 필요 시 시장값 수동 보정
- `sector`: 필요 시 업종값 수동 보정
- `valueUp`, `buyback`, `treasuryCancellation`, `payoutRaise`: 주주환원/Value-up 체크리스트
- `assetSale`, `spinOff`, `insiderBuying`, `foreignOwnershipRebound`, `coverageInitiation`: 재평가 체크리스트
- `note`: 리포트 본문에 함께 표시할 메모

동작 방식:

1. 입력 CSV를 먼저 읽습니다.
2. `manual-overrides.csv`가 있으면 종목코드 또는 종목명으로 병합합니다.
3. 오버레이 값이 있는 항목만 덮어씁니다.
4. 리포트에 `수동 오버레이`와 `수동 메모`가 같이 표시됩니다.

즉 추천 점수는 자동 데이터 + 내가 직접 아는 정성 정보가 합쳐진 결과로 볼 수 있습니다.

## 서버 파이프라인 한 번에 실행

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
OPENDART_API_KEY=발급받은키 \
node ./scripts/run-daily-pipeline.mjs
```

이 스크립트는 `KRX 기본정보 CSV 기준 유니버스 선정 -> DART 수집 -> KRX 병합 -> 리포트 생성` 순서로 실행합니다. 환경변수 `REPORT_LIMIT` 이 없으면 기본 100개 종목만 대상으로 삼습니다.

이미 있는 CSV로 리포트만 다시 만들고 싶다면:

```bash
cd /Users/ahn-yongsung/Project/investment-checklist-screener
node ./scripts/run-report-only.mjs
```

## 추천 사용 흐름

1. 한국주식 또는 관심 유니버스 CSV를 준비합니다.
2. `URL 불러오기` 또는 아래 텍스트 영역에 붙여넣습니다.
3. 최소 점수, 촉매 필터, 확신도 필터, 상위 종목 수를 조정합니다.
4. 상위 후보만 먼저 읽고, 통과 이유와 정보 충실도를 확인합니다.

## CSV 형식

```csv
name,market,sector,marketCap,per,pbr,evToEbitda,fcfYield,roe,roic,roicTrend3Y,debtRatio,opMargin,opMarginTrend3Y,interestCoverage,ocfToNetIncome,dividendYield,shareholderReturn,netCash,catalyst,governance,confidence,valueUp,buyback,treasuryCancellation,payoutRaise,assetSale,spinOff,insiderBuying,foreignOwnershipRebound,coverageInitiation
메리츠금융지주,KOSPI,금융,21000000000000,6.2,1.35,-,-,24.5,18.8,3.4,82,28,4.2,9.4,1.12,5.2,strong,true,strong,strong,high,true,true,true,true,false,false,false,true,true
```

## 입력 규칙

- `netCash`: `true` 또는 `false`
- `catalyst`: `strong`, `medium`, `weak`
- `governance`: `strong`, `medium`, `weak`
- `shareholderReturn`: `strong`, `medium`, `weak`
- `confidence`: `high`, `medium`, `low`
- `marketCap`: 원 단위 숫자
- `evToEbitda`: 숫자
- `fcfYield`: 숫자
- `roicTrend3Y`: 최근 3개년 기준 ROIC 변화폭
- `dividendYield`: 숫자
- `opMarginTrend3Y`: 최근 3개년 기준 영업이익률 변화폭
- `interestCoverage`: 숫자
- `ocfToNetIncome`: 숫자
- 체크리스트 필드: `true` 또는 `false`

## 자동 수집에서 채워지는 값

- OpenDART 스크립트는 현재 `ROE`, `ROIC`, `영업이익률`, `부채비율`, `이자보상배율`, `현금전환율`, `EBITDA`, `FCF`, `3년 추세` 중심의 정량 데이터를 채웁니다.
- `촉매`, `거버넌스`, `확신도`는 일부만 약하게 추정하거나 비워둡니다.
- `주주환원`은 KRX 배당수익률 기반으로 약하게 추정하고, 체크리스트는 기본적으로 비워 둡니다.
- 그래서 자동 추천은 1차 후보 압축용으로 쓰고, 최종 판단 전에 정성 검토가 꼭 필요합니다.
- KRX CSV를 병합하면 `시장`, `업종`, `시가총액`, `PER`, `PBR`, `배당수익률`에 더해 `EV/EBITDA`, `FCF Yield`를 계산할 수 있습니다.
- 정성 항목은 [manual-overrides.csv](/Users/ahn-yongsung/Project/investment-checklist-screener/data/manual-overrides.csv) 로 수동 보강할 수 있습니다.

## 주의

이 도구는 아이디어를 정리하는 보조 도구입니다. 실제 투자 전에는 공시, 실적, 산업 구조, 대주주 행동, 자본 배치 이력까지 별도로 확인해야 합니다.

## 참고한 공식 화면

- [KRX Data Marketplace 메인](https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd)
- [주식 전종목/기본정보 계열 화면](https://data.krx.co.kr/contents/MMC/ISIF/isif/MMCISIF003.cmd?tabIndex=0)
- [주식 전종목/PER PBR 계열 화면](https://data.krx.co.kr/contents/MMC/ISIF/isif/MMCISIF003.cmd?tabIndex=1)
