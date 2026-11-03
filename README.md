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
| `GOOGLE_CLIENT_ID` | Google OAuth 웹 애플리케이션의 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 웹 애플리케이션의 서버 전용 Client Secret |
| `GOOGLE_REDIRECT_URI` | Google Cloud에 등록한 OAuth 콜백 URL |

`.env`와 `.env.*`는 Git에서 제외됩니다. 예시 파일 `.env.example`만 저장소에 포함하세요. 실제 비밀키, 계정 데이터 또는 데이터베이스 파일을 커밋하거나 공유하지 마세요.

### Google 로그인 설정

Google 로그인을 활성화하려면 다음 서버 환경변수 세 개를 모두 설정하고 API 서버를 재시작하세요. 값이 비어 있으면 Google 버튼은 설정이 필요하다는 안내를 표시하며, 이메일 로그인과 회원가입은 계속 사용할 수 있습니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 선택하거나 새 프로젝트를 만듭니다.
2. **Google Auth Platform → Branding**에서 앱 이름과 사용자 지원 이메일을 설정하고, **Audience**에서 대상 사용자를 설정합니다. 앱이 Testing 상태라면 테스트할 Google 계정을 테스트 사용자에 추가하세요.
3. **Clients → Create client → Web application**에서 OAuth 클라이언트를 생성합니다.
4. **Authorized JavaScript origins**에 사이트의 origin만 등록합니다. 로컬 개발 예: `http://localhost:5173`; Render 배포는 실제 서비스 origin을 사용합니다.
5. **Authorized redirect URIs**에 콜백 URL을 정확히 등록합니다. 로컬 개발 예: `http://localhost:5173/api/auth/google/callback`. Render 배포 예: `https://<서비스이름>.onrender.com/api/auth/google/callback`.
6. 생성 화면에서 발급된 Client ID와 Client Secret을 서버의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 입력합니다. `GOOGLE_REDIRECT_URI`에는 5단계의 URI와 완전히 동일한 값을 설정합니다.
7. 개발 환경에서는 프로젝트 `.env`에 값을 저장합니다. Render에서는 **Dashboard → 서비스 → Environment**에서 서버 환경변수로 설정하세요. Client Secret은 프런트엔드 변수(`VITE_*`)로 만들거나 GitHub에 올리지 마세요.

서버는 Authorization Code 흐름을 사용하고, 일회성 state와 nonce를 HttpOnly 쿠키로 확인합니다. Google의 `google-auth-library`로 ID 토큰 서명·발급자·대상·만료를 검증하며, 검증된 이메일을 기준으로 기존 계정을 연결합니다. `google_sub`는 기존 사용자 행에 추가되는 nullable 고유 값이며, 기존 학습·친구·게임 데이터는 유지됩니다.

## 데이터 및 배포 참고

계정과 앱 데이터는 서버의 SQLite 파일에 저장됩니다. 운영 환경에서는 데이터베이스 파일을 영구 저장소에 두고 정기적으로 백업하세요. 현재 구성은 단일 서버 인스턴스를 전제로 하므로 수평 확장 시 공유 데이터베이스 및 세션 저장소가 필요합니다. 공개 배포에는 HTTPS, 강력한 서버 비밀키, 백업과 모니터링을 설정하세요.
