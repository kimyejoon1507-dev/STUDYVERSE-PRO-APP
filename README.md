# STUDYVERSE PRO

STUDYVERSE PRO는 학습 관리와 퀴즈, 친구 채팅, 브롤러 수집 및 아레나 게임을 결합한 반응형 한국어 웹 앱입니다. React, TypeScript, Vite 프런트엔드와 Express, Socket.IO, SQLite 백엔드로 구성되어 있습니다.

## 주요 기능

- 국어·영어·수학·과학·사회 학습 기록, 진도 및 주간 계획
- 학습 자료 기반 퀴즈와 오답 기록
- 사용자 ID 기반 친구 요청, 온라인 상태, 1:1·그룹 실시간 채팅
- 학습 퀴즈로 브롤러를 획득하고 능력별 전투를 진행하는 아레나
- 서버 검증 보석·브롤러 진행 상태와 기존 상점·인벤토리
- 계정별 SQLite 저장, 비밀번호 해시, 세션 쿠키, XP·미션·업적
- 데스크톱, 태블릿, 모바일 화면 지원

## 요구 사항

- Node.js 20.19 이상 또는 22.12 이상
- npm

## 설치 및 실행

PowerShell에서 프로젝트 폴더로 이동하고 의존성을 설치합니다.

```powershell
cd "$HOME\Desktop\STUDYVERSE PRO"
npm install
Copy-Item .env.example .env
```

`.env`에 앱의 서버 전용 설정을 지정합니다. `JWT_SECRET`은 32자 이상의 임의 값으로 바꾸세요.

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

출력된 값을 `.env`의 `JWT_SECRET`에 입력한 뒤 개발 서버를 실행합니다.

```powershell
npm run dev
```

- 웹 앱: `http://localhost:5173`
- API 및 실시간 채팅: `http://localhost:3001`
- SQLite 데이터베이스: `data/studyverse.sqlite`

`npm run dev`는 Vite 웹 서버와 Express API 서버를 함께 실행합니다. 회원가입 후 앱을 사용할 수 있습니다. 외부 AI API 키는 필요하지 않습니다.

## 빌드 및 프로덕션 실행

```powershell
npm run build
npm start
```

`npm run build`는 클라이언트와 서버 TypeScript 검사 후 Vite 프로덕션 빌드를 생성합니다. `npm start`는 빌드된 정적 파일과 API를 제공합니다.

## 환경 변수

| 변수 | 설명 |
| --- | --- |
| `JWT_SECRET` | 세션 서명에 사용하는 서버 전용 임의 비밀키 (필수) |
| `PORT` | API 포트 (기본값: `3001`) |
| `DB_FILE` | SQLite 파일 경로 (기본값: `./data/studyverse.sqlite`) |
| `CLIENT_URL` | 프로덕션 클라이언트 URL |
| `NODE_ENV` | `development` 또는 `production` |

`.env`와 `.env.*`는 Git에서 제외됩니다. 예시 파일 `.env.example`만 저장소에 포함하세요. 실제 비밀키, 계정 데이터 또는 데이터베이스 파일을 커밋하거나 공유하지 마세요.

## 데이터 및 배포 참고

계정과 앱 데이터는 서버의 SQLite 파일에 저장됩니다. 운영 환경에서는 데이터베이스 파일을 영구 저장소에 두고 정기적으로 백업하세요. 현재 구성은 단일 서버 인스턴스를 전제로 하므로 수평 확장 시 공유 데이터베이스 및 세션 저장소가 필요합니다. 공개 배포에는 HTTPS, 강력한 서버 비밀키, 백업과 모니터링을 설정하세요.
