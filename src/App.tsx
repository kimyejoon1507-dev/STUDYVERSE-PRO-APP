import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Activity, ArrowLeft, ArrowRight, Award, BookOpen, CalendarDays, Check, ChevronDown, CircleHelp,
  Clock3, Coins, Crosshair, Gamepad2, GraduationCap, Heart, LogOut, MessageCircle, Plus, Search,
  Send, Shield, ShoppingBag, Sparkles, Target, Trophy, UserRound, Users, X, Zap
} from 'lucide-react';

type User = { id: string; userId: string; loginName: string; nickname: string; avatar: string; coins: number; xp: number; level: number };
type Subject = '국어' | '영어' | '수학' | '과학' | '사회';
type Page = 'home' | 'study' | 'quiz' | 'friends' | 'arena' | 'shop' | 'profile';
type Friend = { id: string; user_id: string; nickname: string; avatar: string; online?: boolean };
type Conversation = { id: string; kind: string; name: string; last_body: string | null; members: Friend[] };
type Message = { id: string; senderId: string; nickname?: string; avatar?: string; body: string; createdAt: string };
type QuizQuestion = { kind: 'choice' | 'written'; question: string; answer: string; choices: string[]; explanation: string };
type StudyRecord = { subject: Subject; minutes: number; created_at: string };
type StudyPlan = { id: string; subject: Subject; title: string; date: string; targetMinutes: number; completed: number };
type Exam = { id: string; subject: Subject; title: string; date: string };
type StoreItem = { id: string; name: string; category: string; description: string; price: number; max: number };
type InventoryItem = { itemId: string; quantity: number; equipped: number };
type PurchaseRecord = { itemId: string; itemName: string; price: number; currency: 'coins' | 'gems'; purchasedAt: string };
type DailyMission = { id: string; title: string; detail: string; target: number; progress: number; coins: number; xp: number; completed: boolean; claimed: boolean };
type Achievement = { id: string; title: string; detail: string; progress: number; target: number; unlocked: boolean };
type QuizMistake = { id: string; subject: Subject; question: string; correctAnswer: string; submittedAnswer: string; createdAt: string };

const subjectList: Subject[] = ['국어', '영어', '수학', '과학', '사회'];
const subjectColors: Record<Subject, string> = { 국어: '#ef8bca', 영어: '#67b9ff', 수학: '#a58bff', 과학: '#55d6bf', 사회: '#f4b65e' };
const navItems: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: 'home', label: '대시보드', icon: Activity },
  { id: 'study', label: '학습 플래너', icon: BookOpen },
  { id: 'quiz', label: '퀴즈 메이커', icon: CircleHelp },
  { id: 'friends', label: '친구 & 채팅', icon: Users },
  { id: 'arena', label: '코스믹 아레나', icon: Gamepad2 },
  { id: 'shop', label: '상점 & 장비', icon: ShoppingBag }
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? '요청을 처리하지 못했습니다.');
  return payload as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
function formatTime(date: string) {
  return new Date(date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
function initials(name: string) {
  return [...name].slice(0, 1).join('').toUpperCase() || 'S';
}
function Avatar({ user, size = 'md' }: { user?: Pick<User, 'nickname' | 'avatar'>; size?: 'sm' | 'md' | 'lg' }) {
  return user?.avatar
    ? <img className={`avatar avatar-${size}`} src={user.avatar} alt="" />
    : <span className={`avatar avatar-${size}`}>{initials(user?.nickname ?? '?')}</span>;
}
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3400);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return <div className="toast"><Check size={16} />{message}<button aria-label="알림 닫기" onClick={onClose}><X size={15} /></button></div>;
}
function StatCard({ label, value, unit, icon: Icon, tone }: { label: string; value: string | number; unit?: string; icon: typeof Activity; tone: string }) {
  return <article className={`stat-card ${tone}`}><div className="stat-icon"><Icon size={18} /></div><p>{label}</p><strong>{value}<small>{unit}</small></strong></article>;
}
function MissionPanel({ missions, onClaim }: { missions: DailyMission[]; onClaim: (mission: DailyMission) => void }) {
  return <section className="panel missions-panel"><div className="panel-heading"><div><span className="eyebrow">DAILY MISSIONS</span><h2>오늘의 미션</h2></div><Award size={18} className="muted-icon" /></div><div className="mission-grid">{missions.map(mission => <article className="mission-card" key={mission.id}><div className={`mission-check ${mission.claimed ? 'claimed' : mission.completed ? 'complete' : ''}`}>{mission.claimed ? <Check size={14} /> : <Sparkles size={14} />}</div><div className="mission-copy"><b>{mission.title}</b><small>{mission.detail}</small><div className="mission-progress"><i style={{ width: `${Math.min(100, mission.progress / mission.target * 100)}%` }} /></div><small>{mission.progress} / {mission.target} · +{mission.coins} 코인 · +{mission.xp} XP</small></div><button className={`mission-claim ${mission.claimed ? 'claimed' : ''}`} disabled={!mission.completed || mission.claimed} onClick={() => onClaim(mission)}>{mission.claimed ? '완료' : mission.completed ? '보상 받기' : '진행 중'}</button></article>)}</div></section>;
}
function AchievementPanel({ achievements }: { achievements: Achievement[] }) {
  return <section className="panel achievements-panel"><div className="panel-heading"><div><span className="eyebrow">MILESTONES</span><h2>탐험 업적</h2></div><Trophy size={18} className="muted-icon" /></div><div className="achievement-grid">{achievements.map(achievement => <article className={`achievement-card ${achievement.unlocked ? 'unlocked' : ''}`} key={achievement.id}><span>{achievement.unlocked ? <Award size={17} /> : <Target size={17} />}</span><div><b>{achievement.title}</b><small>{achievement.detail}</small><div className="achievement-progress"><i style={{ width: `${Math.min(100, achievement.progress / achievement.target * 100)}%` }} /></div></div></article>)}</div></section>;
}
function PlanList({ plans, onToggle, emptyText }: { plans: StudyPlan[]; onToggle: (plan: StudyPlan) => void; emptyText: string }) {
  return plans.length
    ? <div className="plan-list">{plans.map(plan => <article className={`plan-item ${plan.completed ? 'completed' : ''}`} key={plan.id}><button className="plan-check" onClick={() => onToggle(plan)} aria-label={plan.completed ? '계획 완료 취소' : '계획 완료 표시'}>{plan.completed ? <Check size={14} /> : null}</button><span className="plan-subject" style={{ color: subjectColors[plan.subject] }}>{plan.subject}</span><strong>{plan.title}</strong><small>{new Date(`${plan.date}T00:00:00`).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })} · 목표 {plan.targetMinutes}분</small></article>)}</div>
    : <p className="empty-note">{emptyText}</p>;
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api<{ user: User }>('/api/auth/login', json(data));
      onLogin(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth-page">
    <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
    <div className="auth-card">
      <a className="brand auth-brand" href="#"><span className="brand-mark"><Sparkles size={20} /></span><span>STUDYVERSE<small>PRO</small></span></a>
      <div className="auth-intro"><span className="eyebrow">YOUR UNIVERSE, YOUR PACE</span><h1>이름과 비밀번호로<br /><span>간편하게 시작해요.</span></h1><p>처음 입력한 이름이면 계정이 자동으로 만들어져요.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label>이름<input name="name" autoComplete="username" placeholder="사용할 이름" required minLength={2} maxLength={24} /></label>
        <label>비밀번호<input name="password" type="password" autoComplete="current-password" placeholder="10자 이상 입력" required minLength={10} maxLength={128} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button wide" disabled={busy}>{busy ? '잠시만요…' : '로그인 · 자동 가입'}<ArrowRight size={17} /></button>
      </form>
      <div className="auth-security"><Shield size={14} /> 비밀번호는 암호화되어 안전하게 저장됩니다.</div>
    </div>
  </main>;
}

function Dashboard({ user, refreshUser, notify, missions, onClaim }: { user: User; refreshUser: () => Promise<void>; notify: (message: string) => void; missions: DailyMission[]; onClaim: (mission: DailyMission) => void }) {
  const [study, setStudy] = useState<StudyRecord[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [quizzes, setQuizzes] = useState<{ subject: Subject; score: number; total: number }[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [minutes, setMinutes] = useState('30');
  const [subject, setSubject] = useState<Subject>('수학');
  const [examTitle, setExamTitle] = useState('');
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [result, planResult] = await Promise.all([
      api<{ study: StudyRecord[]; quizzes: typeof quizzes; exams: Exam[]; achievements: Achievement[] }>('/api/dashboard'),
      api<{ plans: StudyPlan[] }>('/api/plans')
    ]);
    setStudy(result.study);
    setQuizzes(result.quizzes);
    setExams(result.exams);
    setAchievements(result.achievements);
    setPlans(planResult.plans);
  }, []);
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [load]);
  const today = new Date().toISOString().slice(0, 10);
  const todayMinutes = study.filter(item => item.created_at.slice(0, 10) === today).reduce((sum, item) => sum + item.minutes, 0);
  const weekMinutes = study.filter(item => Date.now() - new Date(item.created_at).getTime() < 7 * 86400000).reduce((sum, item) => sum + item.minutes, 0);
  const average = quizzes.length ? Math.round(quizzes.reduce((sum, item) => sum + item.score / item.total, 0) / quizzes.length * 100) : 0;
  const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const weekBars = dayLabels.map((label, index) => {
    const date = new Date();
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset + index);
    const key = date.toISOString().slice(0, 10);
    return { label, value: study.filter(item => item.created_at.slice(0, 10) === key).reduce((sum, item) => sum + item.minutes, 0) };
  });
  async function addStudy(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/study', json({ subject, minutes: Number(minutes), note: '대시보드에서 기록' }));
      await Promise.all([load(), refreshUser()]);
      notify(`${subject} ${minutes}분 학습을 기록했어요.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장에 실패했습니다.'); }
  }
  async function addExam(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/exams', json({ subject, title: examTitle, date: examDate }));
      setExamTitle('');
      setExamDate('');
      await load();
      notify('시험 일정을 저장했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장에 실패했습니다.'); }
  }
  async function togglePlan(plan: StudyPlan) {
    try { await api(`/api/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ completed: !plan.completed }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '계획 상태를 저장하지 못했습니다.'); }
  }
  return <div className="page-stack">
    <section className="welcome-panel">
      <div className="welcome-copy"><span className="eyebrow"><span className="live-dot" /> 오늘도 좋은 궤도예요</span><h1>안녕하세요, {user.nickname}님 <span className="wave">✦</span></h1><p>작은 집중이 큰 성장을 만들어요. 오늘의 우주를 탐험해 볼까요?</p><div className="welcome-actions"><a className="primary-button" href="#study" onClick={event => { event.preventDefault(); document.getElementById('quick-study')?.scrollIntoView({ behavior: 'smooth' }); }}>공부 기록하기 <ArrowRight size={16} /></a><span className="level-chip"><Sparkles size={14} /> LV. {user.level}</span></div></div>
      <div className="welcome-planet"><div className="planet-ring" /><div className="planet-core" /><span className="planet-star star-a">✦</span><span className="planet-star star-b">·</span><span className="planet-star star-c">✧</span></div>
    </section>
    <section className="stats-grid">
      <StatCard label="오늘 학습" value={todayMinutes} unit="분" icon={Clock3} tone="violet" />
      <StatCard label="이번 주 집중" value={weekMinutes >= 60 ? Math.floor(weekMinutes / 60) : weekMinutes} unit={weekMinutes >= 60 ? '시간' : '분'} icon={Activity} tone="cyan" />
      <StatCard label="퀴즈 정답률" value={average} unit="%" icon={Target} tone="pink" />
      <StatCard label="보유 코인" value={user.coins.toLocaleString()} unit=" C" icon={Coins} tone="gold" />
    </section>
    <div className="dashboard-grid">
      <section className="panel weekly-panel">
        <div className="panel-heading"><div><span className="eyebrow">WEEKLY FOCUS</span><h2>이번 주 공부 시간</h2></div><span className="panel-icon"><Activity size={17} /></span></div>
        <div className="weekly-chart">{weekBars.map((bar, index) => <div className="chart-column" key={bar.label}><span>{bar.value ? `${bar.value}분` : ''}</span><div className="bar-track"><i style={{ height: `${Math.min(100, Math.max(4, bar.value / Math.max(60, ...weekBars.map(item => item.value)) * 100))}%`, animationDelay: `${index * 70}ms` }} /></div><small>{bar.label}</small></div>)}</div>
        <div className="chart-footer"><span><i className="legend-dot" /> 학습 시간</span><strong>{Math.floor(weekMinutes / 60)}시간 {weekMinutes % 60}분</strong></div>
      </section>
      <section className="panel subject-panel">
        <div className="panel-heading"><div><span className="eyebrow">SUBJECT TRACKER</span><h2>과목별 학습 기록</h2></div><BookOpen size={18} className="muted-icon" /></div>
        <div className="subject-list">{subjectList.map(name => {
          const value = study.filter(item => item.subject === name && Date.now() - new Date(item.created_at).getTime() < 7 * 86400000).reduce((sum, item) => sum + item.minutes, 0);
          const total = Math.max(60, ...subjectList.map(item => study.filter(record => record.subject === item && Date.now() - new Date(record.created_at).getTime() < 7 * 86400000).reduce((sum, record) => sum + record.minutes, 0)));
          return <div className="subject-row" key={name}><span className="subject-name"><i style={{ backgroundColor: subjectColors[name] }} />{name}</span><div className="subject-progress"><i style={{ width: `${Math.min(100, value / total * 100)}%`, backgroundColor: subjectColors[name] }} /></div><small>{value}분</small></div>;
        })}</div>
      </section>
      <section className="panel quick-study-panel" id="quick-study">
        <div className="panel-heading"><div><span className="eyebrow">QUICK LOG</span><h2>오늘의 학습 기록</h2></div><span className="panel-icon"><Plus size={17} /></span></div>
        <form className="inline-form" onSubmit={addStudy}><select value={subject} onChange={event => setSubject(event.target.value as Subject)}>{subjectList.map(item => <option key={item}>{item}</option>)}</select><label className="input-with-unit"><input type="number" min="1" max="240" value={minutes} onChange={event => setMinutes(event.target.value)} required /><span>분</span></label><button className="primary-button compact">저장 <Check size={15} /></button></form>
        <div className="note-line"><Sparkles size={14} /> 10분 학습마다 XP 보상이 쌓여요</div>
      </section>
      <section className="panel exams-panel">
        <div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h2>다가오는 시험</h2></div><GraduationCap size={19} className="muted-icon" /></div>
        <form className="exam-form" onSubmit={addExam}><input placeholder="시험 이름" value={examTitle} onChange={event => setExamTitle(event.target.value)} required maxLength={80} /><div className="exam-form-row"><select value={subject} onChange={event => setSubject(event.target.value as Subject)}>{subjectList.map(item => <option key={item}>{item}</option>)}</select><input type="date" min={today} value={examDate} onChange={event => setExamDate(event.target.value)} required /><button className="icon-button" aria-label="시험 일정 추가"><Plus size={17} /></button></div></form>
        <div className="exam-list">{exams.length ? exams.slice(0, 3).map(exam => {
          const days = Math.max(0, Math.ceil((new Date(`${exam.date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000));
          return <div className="exam-item" key={exam.id}><span className="exam-subject" style={{ color: subjectColors[exam.subject] }}>{exam.subject}</span><div><strong>{exam.title}</strong><small>{exam.date}</small></div><b>{days === 0 ? 'D-DAY' : `D-${days}`}</b></div>;
        }) : <p className="empty-note">등록된 시험 일정이 없어요.</p>}</div>
      </section>
    </div>
    <section className="panel dashboard-plans"><div className="panel-heading"><div><span className="eyebrow">TODAY & THIS WEEK</span><h2>오늘의 공부 계획</h2></div><CalendarDays size={18} className="muted-icon" /></div><PlanList plans={plans} onToggle={plan => void togglePlan(plan)} emptyText="등록된 계획이 없어요. 학습 플래너에서 이번 주 계획을 추가해 보세요." /></section>
    <MissionPanel missions={missions} onClaim={onClaim} />
    <AchievementPanel achievements={achievements} />
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function StudyPlanner({ notify, refreshUser }: { notify: (message: string) => void; refreshUser: () => Promise<void> }) {
  const [subject, setSubject] = useState<Subject>('국어');
  const [minutes, setMinutes] = useState('45');
  const [note, setNote] = useState('');
  const [study, setStudy] = useState<StudyRecord[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [planSubject, setPlanSubject] = useState<Subject>('수학');
  const [planTitle, setPlanTitle] = useState('');
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10));
  const [planMinutes, setPlanMinutes] = useState('30');
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const load = useCallback(async () => {
    const [dashboard, planData] = await Promise.all([
      api<{ study: StudyRecord[] }>('/api/dashboard'),
      api<{ plans: StudyPlan[] }>('/api/plans')
    ]);
    setStudy(dashboard.study);
    setPlans(planData.plans);
  }, []);
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      await api('/api/study', json({ subject, minutes: Number(minutes), note }));
      setNote('');
      await Promise.all([load(), refreshUser()]);
      notify('학습 기록을 저장했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장에 실패했습니다.'); }
  }
  async function savePlan(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      await api('/api/plans', json({ subject: planSubject, title: planTitle, date: planDate, targetMinutes: Number(planMinutes) }));
      setPlanTitle('');
      await load();
      notify('주간 학습 계획을 저장했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '계획을 저장하지 못했습니다.'); }
  }
  async function togglePlan(plan: StudyPlan) {
    try {
      await api(`/api/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ completed: !plan.completed }) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '계획 상태를 저장하지 못했습니다.'); }
  }
  const total = study.reduce((sum, item) => sum + item.minutes, 0);
  return <div className="page-stack">
    <div className="page-title"><div><span className="eyebrow">LEARNING ORBIT</span><h1>학습 플래너</h1><p>계획을 세우고, 집중한 시간을 차곡차곡 기록해요.</p></div><span className="title-badge"><BookOpen size={17} /> 주간 학습 {Math.floor(total / 60)}시간 {total % 60}분</span></div>
    <div className="planner-grid">
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">NEW SESSION</span><h2>공부 기록 추가</h2></div><Plus size={18} className="muted-icon" /></div>
        <form className="stack-form" onSubmit={save}><label>과목<select value={subject} onChange={event => setSubject(event.target.value as Subject)}>{subjectList.map(item => <option key={item}>{item}</option>)}</select></label><label>집중 시간<input type="number" min="1" max="240" value={minutes} onChange={event => setMinutes(event.target.value)} required /></label><label>오늘의 메모<input placeholder="예: 함수의 극한 개념 복습" value={note} onChange={event => setNote(event.target.value)} maxLength={300} /></label><button className="primary-button wide">기록 저장하기 <Check size={16} /></button></form>
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">STUDY HISTORY</span><h2>최근 학습 기록</h2></div><Clock3 size={18} className="muted-icon" /></div>
        <div className="history-list">{study.length ? study.slice(0, 12).map((item, index) => <div className="history-item" key={`${item.created_at}-${index}`}><span className="history-subject" style={{ color: subjectColors[item.subject] }}>{item.subject}</span><span>{item.minutes}분 집중</span><small>{new Date(item.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} · {formatTime(item.created_at)}</small></div>) : <div className="empty-state"><BookOpen size={25} /><p>첫 공부 기록을 남겨볼까요?</p></div>}</div>
      </section>
    </div>
    <section className="panel weekly-plan-panel"><div className="panel-heading"><div><span className="eyebrow">WEEKLY STUDY PLAN</span><h2>오늘과 이번 주 계획</h2></div><CalendarDays size={18} className="muted-icon" /></div><div className="weekly-plan-grid"><form className="plan-form" onSubmit={savePlan}><label>과목<select value={planSubject} onChange={event => setPlanSubject(event.target.value as Subject)}>{subjectList.map(item => <option key={item}>{item}</option>)}</select></label><label>학습할 내용<input value={planTitle} onChange={event => setPlanTitle(event.target.value)} placeholder="예: 일차함수 개념 정리" minLength={2} maxLength={100} required /></label><div className="plan-form-row"><label>날짜<input type="date" min={today} value={planDate} onChange={event => setPlanDate(event.target.value)} required /></label><label>목표 시간(분)<input type="number" min="1" max="240" value={planMinutes} onChange={event => setPlanMinutes(event.target.value)} required /></label><button className="primary-button compact"><Plus size={14} /> 계획 추가</button></div></form><div className="plan-list-wrap"><PlanList plans={plans} onToggle={plan => void togglePlan(plan)} emptyText="이번 주 계획이 비어 있어요." /></div></div></section>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function QuizPage({ refreshUser, notify }: { refreshUser: () => Promise<void>; notify: (message: string) => void }) {
  const [text, setText] = useState('');
  const [subject, setSubject] = useState<Subject>('과학');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState<QuizMistake[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loadMistakes = useCallback(async () => setMistakes((await api<{ mistakes: QuizMistake[] }>('/api/mistakes')).mistakes), []);
  useEffect(() => { void loadMistakes().catch(reason => setError(reason.message)); }, [loadMistakes]);
  function generate() {
    setError('');
    const sentences = text.split(/[.!?。！？\n]+/).map(line => line.trim()).filter(line => line.length > 10).slice(0, 6);
    if (sentences.length === 0) { setError('퀴즈를 만들려면 10자 이상의 학습 내용을 입력해 주세요.'); return; }
    const stopWords = new Set(['그리고', '하지만', '때문에', '이것은', '있습니다', '합니다', '대한', '통해']);
    const words = [...new Set(text.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [])].filter(word => !stopWords.has(word));
    const next: QuizQuestion[] = sentences.map((sentence, index) => {
      const answer = (sentence.match(/[가-힣A-Za-z0-9]{2,}/g) ?? []).filter(word => !stopWords.has(word)).sort((a, b) => b.length - a.length)[0] ?? sentence.slice(0, 2);
      const blanked = sentence.replace(answer, '＿＿＿');
      const choices = [...new Set([answer, ...words.filter(word => word !== answer).slice(index, index + 3)])].sort(() => Math.random() - 0.5);
      return { kind: 'choice' as const, question: `빈칸에 들어갈 핵심어를 골라 보세요.\n${blanked}`, answer, choices, explanation: `입력한 학습 내용에서 가져온 핵심어는 “${answer}”입니다.` };
    });
    const writtenAnswer = words.sort((a, b) => b.length - a.length)[0] ?? next[0].answer;
    next.push({
      kind: 'written',
      question: '학습 내용의 핵심어를 포함해 한 문장으로 설명해 보세요.',
      answer: writtenAnswer,
      choices: [],
      explanation: `응답에 핵심어 “${writtenAnswer}”가 포함되면 정답 처리합니다.`
    });
    setQuestions(next);
    setAnswers({});
    setResult(null);
  }
  async function submitQuiz() {
    if (Object.keys(answers).length !== questions.length) { setError('모든 문제에 답을 선택해 주세요.'); return; }
    const isCorrect = (question: QuizQuestion, index: number) => question.kind === 'written'
      ? Boolean(answers[index]?.toLocaleLowerCase().includes(question.answer.toLocaleLowerCase()))
      : answers[index] === question.answer;
    const score = questions.filter(isCorrect).length;
    const wrongAnswers = questions.flatMap((question, index) => isCorrect(question, index) ? [] : [{
      question: question.question, correctAnswer: question.answer, submittedAnswer: answers[index] ?? ''
    }]);
    setBusy(true); setError('');
    try {
      await api('/api/quizzes', json({ subject, score, total: questions.length, mistakes: wrongAnswers }));
      setResult(score);
      await Promise.all([refreshUser(), loadMistakes()]);
      notify(`퀴즈 결과 저장 완료 · ${score}/${questions.length}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '결과 저장에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <div className="page-title"><div><span className="eyebrow">KNOWLEDGE LAB</span><h1>나만의 퀴즈</h1><p>직접 입력한 학습 내용에서 핵심어 퀴즈를 만들어요.</p></div><span className="title-badge"><Sparkles size={17} /> 개인 학습 노트 기반</span></div>
    <div className="quiz-grid">
      <section className="panel quiz-create"><div className="panel-heading"><div><span className="eyebrow">QUIZ GENERATOR</span><h2>학습 내용 입력</h2></div><CircleHelp size={18} className="muted-icon" /></div>
        <label className="field-label">과목<select value={subject} onChange={event => setSubject(event.target.value as Subject)}>{subjectList.map(item => <option key={item}>{item}</option>)}</select></label>
        <textarea className="lesson-input" value={text} onChange={event => setText(event.target.value)} placeholder="오늘 배운 내용을 문장으로 입력해 주세요. 문장별 핵심어 빈칸 문제를 만들어 드려요." maxLength={6000} />
        <div className="quiz-create-footer"><small>{text.length} / 6,000자 · 내용은 이 브라우저에서 퀴즈 생성에 사용됩니다.</small><button className="primary-button" onClick={generate}>퀴즈 생성 <Sparkles size={16} /></button></div>
      </section>
      <section className="panel quiz-panel"><div className="panel-heading"><div><span className="eyebrow">PRACTICE</span><h2>문제 풀이</h2></div><Target size={18} className="muted-icon" /></div>
        {!questions.length ? <div className="empty-state"><div className="empty-orbit"><CircleHelp size={28} /></div><p>학습 내용을 입력하고<br />첫 퀴즈를 만들어 보세요.</p></div> : <div className="quiz-questions">{questions.map((question, index) => <article className="question-card" key={`${index}-${question.answer}`}><span className="question-index">QUESTION {String(index + 1).padStart(2, '0')} · {question.kind === 'written' ? '주관식' : '객관식'}</span><h3>{question.question}</h3>{question.kind === 'written' ? <textarea className="written-answer" value={answers[index] ?? ''} disabled={result !== null} onChange={event => setAnswers(current => ({ ...current, [index]: event.target.value }))} placeholder="핵심어를 포함해 답을 적어 보세요." maxLength={300} /> : <div className="answer-options">{question.choices.map(choice => <button key={choice} className={`answer-option ${answers[index] === choice ? 'selected' : ''} ${result !== null && choice === question.answer ? 'correct' : ''}`} onClick={() => result === null && setAnswers(current => ({ ...current, [index]: choice }))}><span>{choice}</span>{result !== null && choice === question.answer && <Check size={15} />}</button>)}</div>}{result !== null && <p className="explanation">{question.explanation}</p>}</article>)}{result === null ? <button className="primary-button wide" disabled={busy} onClick={() => void submitQuiz()}>{busy ? '저장 중…' : '답안 제출'} <ArrowRight size={16} /></button> : <div className="quiz-result"><Trophy size={18} /><strong>{result} / {questions.length} 정답</strong><button className="text-button" onClick={generate}>다시 도전</button></div>}</div>}
      </section>
    </div>
    <section className="panel wrong-note-panel"><div className="panel-heading"><div><span className="eyebrow">REVIEW YOUR ANSWERS</span><h2>오답 노트 <i className="count-badge">{mistakes.length}</i></h2></div><BookOpen size={18} className="muted-icon" /></div>{mistakes.length ? <div className="mistake-list">{mistakes.map(mistake => <article className="mistake-item" key={mistake.id}><div><span className="history-subject" style={{ color: subjectColors[mistake.subject] }}>{mistake.subject}</span><small>{new Date(mistake.createdAt).toLocaleDateString('ko-KR')}</small></div><p>{mistake.question}</p><div className="mistake-answers"><span>내 답 <b>{mistake.submittedAnswer}</b></span><span>정답 <b>{mistake.correctAnswer}</b></span></div></article>)}</div> : <p className="empty-note">오답이 생기면 여기에 저장되어 다시 확인할 수 있어요.</p>}</section>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function FriendsPage({ user, socket, notify }: { user: User; socket: Socket | null; notify: (message: string) => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<{ id: string; user_id: string; nickname: string; avatar: string }[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [searchId, setSearchId] = useState('');
  const [found, setFound] = useState<Friend | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const [friendData, chatData] = await Promise.all([
      api<{ friends: Friend[]; incoming: typeof incoming }>('/api/friends'),
      api<{ conversations: Conversation[] }>('/api/conversations')
    ]);
    setFriends(friendData.friends); setIncoming(friendData.incoming); setConversations(chatData.conversations);
  }, []);
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [load]);
  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    const onPresenceInitial = (ids: string[]) => setFriends(current => current.map(friend => ({ ...friend, online: ids.includes(friend.id) })));
    const onPresenceUpdate = (presence: { userId: string; online: boolean }) => setFriends(current => current.map(friend => friend.id === presence.userId ? { ...friend, online: presence.online } : friend));
    const onMessage = (message: Message & { conversationId: string }) => {
      if (message.conversationId === active?.id) setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      void load();
    };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('presence:initial', onPresenceInitial); socket.on('presence:update', onPresenceUpdate); socket.on('message:new', onMessage);
    setOnline(socket.connected);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('presence:initial', onPresenceInitial); socket.off('presence:update', onPresenceUpdate); socket.off('message:new', onMessage); };
  }, [socket, active?.id, load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  async function openConversation(conversation: Conversation) {
    setActive(conversation);
    setError('');
    try {
      socket?.emit('conversation:join', conversation.id);
      const data = await api<{ messages: Message[] }>(`/api/conversations/${conversation.id}/messages`);
      setMessages(data.messages);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '대화를 불러오지 못했습니다.'); }
  }
  async function openFriend(friend: Friend) {
    try {
      const result = await api<{ id: string }>(`/api/conversations/direct/${friend.id}`, { method: 'POST' });
      await load();
      const conversation = { id: result.id, kind: 'direct', name: friend.nickname, last_body: null, members: [friend] };
      await openConversation(conversation);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '대화를 시작하지 못했습니다.'); }
  }
  async function searchFriend(event: FormEvent) {
    event.preventDefault(); setError(''); setFound(null);
    try { setFound((await api<{ user: Friend }>(`/api/users/search?id=${encodeURIComponent(searchId)}`)).user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '검색에 실패했습니다.'); }
  }
  async function addFriend() {
    if (!found) return;
    try { await api('/api/friends/requests', json({ userId: found.id })); setFound(null); setSearchId(''); notify('친구 요청을 보냈어요.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '요청에 실패했습니다.'); }
  }
  async function respond(id: string, accept: boolean) {
    try { await api(`/api/friends/requests/${id}/respond`, json({ accept })); await load(); notify(accept ? '친구가 되었어요!' : '요청을 거절했어요.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '처리하지 못했습니다.'); }
  }
  async function createGroup(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ id: string }>('/api/conversations', json({ name: groupName, memberIds: groupMembers }));
      setGroupName(''); setGroupMembers([]); await load();
      await openConversation({ id: result.id, kind: 'group', name: groupName, last_body: null, members: friends.filter(friend => groupMembers.includes(friend.id)) });
      notify('그룹 채팅방을 만들었어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '그룹을 만들지 못했습니다.'); }
  }
  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!active || !draft.trim() || !socket) return;
    const body = draft.trim();
    setDraft('');
    socket.emit('message:send', { conversationId: active.id, body }, (result: { ok: boolean; error?: string; message?: Message }) => {
      if (!result.ok) { setError(result.error ?? '메시지를 보내지 못했습니다.'); setDraft(body); return; }
      if (result.message) setMessages(current => current.some(item => item.id === result.message!.id) ? current : [...current, result.message!]);
    });
  }
  async function moderate(friend: Friend) {
    const action = window.prompt(`${friend.nickname} 님을 신고하려면 사유를 입력하세요. 취소하면 차단합니다.`);
    if (action === null) await api(`/api/users/${friend.id}/block`, { method: 'POST' });
    else if (action.trim().length >= 4) await api(`/api/users/${friend.id}/report`, json({ reason: action.trim() }));
    else { setError('신고 사유는 4자 이상 입력해 주세요.'); return; }
    await load(); setActive(null); notify(action === null ? '사용자를 차단했어요.' : '신고 내용을 접수했어요.');
  }
  const activePartner = active?.members[0];
  return <div className="page-stack">
    <div className="page-title"><div><span className="eyebrow">SOCIAL CONSTELLATION</span><h1>친구와 채팅</h1><p>함께 공부하고 서로 응원하는 우주 친구를 만나보세요.</p></div><span className={`title-badge ${online ? 'connected' : ''}`}><span className="live-dot" /> {online ? '실시간 연결됨' : '연결 중'}</span></div>
    <div className="friends-layout">
      <aside className="friends-side">
        <section className="panel friend-search"><div className="panel-heading"><div><span className="eyebrow">FIND A FRIEND</span><h2>친구 찾기</h2></div><Search size={17} className="muted-icon" /></div><form className="search-form" onSubmit={event => void searchFriend(event)}><input value={searchId} onChange={event => setSearchId(event.target.value)} placeholder="사용자 ID · SV12345678" /><button className="icon-button" aria-label="친구 검색"><Search size={16} /></button></form>{found && <div className="found-user"><Avatar user={found} size="sm" /><span><b>{found.nickname}</b><small>{found.user_id}</small></span><button className="icon-button" onClick={() => void addFriend()} aria-label="친구 요청 보내기"><Plus size={16} /></button></div>}</section>
        {incoming.length > 0 && <section className="panel request-panel"><div className="panel-heading"><div><span className="eyebrow">INCOMING</span><h2>받은 요청 <i className="count-badge">{incoming.length}</i></h2></div></div>{incoming.map(request => <div className="request-item" key={request.id}><Avatar user={request} size="sm" /><span>{request.nickname}</span><button className="accept-button" aria-label="친구 요청 수락" onClick={() => void respond(request.id, true)}><Check size={15} /></button><button className="decline-button" aria-label="친구 요청 거절" onClick={() => void respond(request.id, false)}><X size={15} /></button></div>)}</section>}
        <section className="panel friend-list-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR CREW</span><h2>친구 <i className="count-badge">{friends.length}</i></h2></div></div>{friends.length ? friends.map(friend => <button className="friend-row" key={friend.id} onClick={() => void openFriend(friend)}><span className={`online-indicator ${friend.online ? 'online' : ''}`} /><Avatar user={friend} size="sm" /><span><b>{friend.nickname}</b><small>{friend.online ? '온라인' : '오프라인'} · {friend.user_id}</small></span><MessageCircle size={16} /></button>) : <p className="empty-note">친구 ID로 함께할 친구를 찾아보세요.</p>}</section>
        <section className="panel group-create"><div className="panel-heading"><div><span className="eyebrow">GROUP CHAT</span><h2>그룹 만들기</h2></div><Users size={17} className="muted-icon" /></div><form onSubmit={event => void createGroup(event)}><input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="그룹 이름" required minLength={2} maxLength={50} /><div className="group-select">{friends.map(friend => <label key={friend.id}><input type="checkbox" checked={groupMembers.includes(friend.id)} onChange={event => setGroupMembers(current => event.target.checked ? [...current, friend.id] : current.filter(id => id !== friend.id))} />{friend.nickname}</label>)}</div><button className="secondary-button wide" disabled={!groupMembers.length}>그룹 채팅방 만들기 <Plus size={14} /></button></form></section>
      </aside>
      <section className="panel chat-panel">
        {!active ? <div className="chat-welcome"><div className="chat-orb"><MessageCircle size={26} /></div><h2>대화를 시작해 보세요</h2><p>친구를 선택하면 1:1 실시간 채팅을 할 수 있어요.</p><div className="conversation-list">{conversations.map(conversation => <button className="conversation-row" key={conversation.id} onClick={() => void openConversation(conversation)}><Avatar user={conversation.members[0]} size="sm" /><span><b>{conversation.kind === 'group' ? conversation.name : conversation.members[0]?.nickname ?? '친구'}</b><small>{conversation.last_body ?? '새 대화를 시작해 보세요'}</small></span><ArrowRight size={15} /></button>)}</div></div> : <>
          <div className="chat-header"><button className="chat-back icon-button" onClick={() => setActive(null)} aria-label="대화 목록"><ArrowLeft size={17} /></button><Avatar user={active.kind === 'group' ? undefined : activePartner} size="sm" /><div><strong>{active.kind === 'group' ? active.name : activePartner?.nickname ?? active.name}</strong><small>{active.kind === 'group' ? `${active.members.length + 1}명 그룹` : '친구 · 메시지는 안전하게 저장됩니다'}</small></div>{active.kind === 'direct' && activePartner && <button className="icon-button danger-quiet" onClick={() => void moderate(activePartner)} title="차단 또는 신고"><Shield size={16} /></button>}</div>
          <div className="messages-area">{messages.length ? messages.map(message => <div className={`message-row ${message.senderId === user.id ? 'mine' : ''}`} key={message.id}>{message.senderId !== user.id && <Avatar user={{ nickname: message.nickname ?? '?', avatar: message.avatar ?? '' }} size="sm" />}<div className="message-content">{message.senderId !== user.id && <small>{message.nickname}</small>}<div className="message-bubble">{message.body}</div><time>{formatTime(message.createdAt)}</time></div></div>) : <div className="empty-state"><MessageCircle size={25} /><p>첫 인사를 보내 보세요.</p></div>}<div ref={bottomRef} /></div>
          <form className="message-compose" onSubmit={sendMessage}><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="메시지를 입력하세요…" maxLength={2000} /><button className="primary-button" aria-label="메시지 전송" disabled={!draft.trim()}><Send size={17} /></button></form>
        </>}
        {error && <p className="inline-error chat-error">{error}<button onClick={() => setError('')}><X size={13} /></button></p>}
      </section>
    </div>
  </div>;
}

type GameMode = 'idle' | 'playing' | 'over';
type BrawlerKit = 'seed' | 'cone' | 'fan' | 'beam' | 'return' | 'wave' | 'comet' | 'orbit';
type BrawlerDifficulty = 'easy' | 'medium' | 'hard';
type Brawler = {
  id: string; name: string; rarity: string; image: string; color: string; hp: number; attack: number; speed: number;
  attackStyle: string; specialName: string; special: string; kit: BrawlerKit; requiredCorrect: number;
  freeDay: number | null; freeToday: boolean; price: number; owned: boolean;
};
type ArenaShopState = {
  coins: number; gems: number; dailyRewardClaimed: boolean;
  exchanges: { coinsToGems: boolean; gemsToCoins: boolean };
  limitedOffer: { brawlerId: string; price: number; brawler: Brawler };
};
type BrawlerQuestion = { id: string; subject: string; difficulty: BrawlerDifficulty; question: string; options: string[] };
type BrawlerBoard = { gems: number; weekday: number; freeBrawlerId: string | null; selectedBrawlerId: string; owned: string[]; brawlers: Brawler[] };
type QuizChallenge = { challengeToken: string; isFree: boolean; gems: number; brawler: Pick<Brawler, 'id' | 'name' | 'image' | 'rarity'> & { requiredCorrect: number }; questions: BrawlerQuestion[] };
type QuizFeedback = { correct: boolean; correctAnswer: string; explanation: string; correctCount: number; total: number; completed: boolean; passed: boolean; gems: number; brawler: Pick<Brawler, 'id' | 'name' | 'image' | 'rarity'> | null };
type ShooterEnemy = { x: number; y: number; hp: number; maxHp: number; speed: number; radius: number; color: string; attackCooldown: number; kind: 'drifter' | 'sprinter' | 'thinker' };
type ShooterBullet = { x: number; y: number; vx: number; vy: number; life: number; damage: number; piercing: boolean; returnAt: number; returning: boolean; hitEnemies: Set<ShooterEnemy> };
type ShooterDrop = { x: number; y: number; kind: 'health' | 'energy' | 'growth'; life: number };
type ShooterDamage = { x: number; y: number; amount: number; life: number; color: string };
type ArenaPointer = { zone: 'move' | 'aim'; originX: number; originY: number };
type ShooterState = {
  player: { x: number; y: number; hp: number; maxHp: number; energy: number; speed: number; attack: number; color: string; brawler: Brawler; shield: number };
  enemies: ShooterEnemy[]; bullets: ShooterBullet[]; drops: ShooterDrop[]; damageNumbers: ShooterDamage[]; score: number; wave: number; elapsed: number;
  spawnTimer: number; dropTimer: number; fireTimer: number; specialCooldown: number; startedAt: number;
  runId: string; mode: GameMode; lastFrame: number;
};
const rarityTone: Record<string, string> = { 일반: '#91a4bc', 희귀: '#55b77d', 초희귀: '#52aee0', 영웅: '#a47be5', 신화: '#dd72c5', 전설: '#f0ae59' };
const weekdayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
function BrawlerCard({ brawler, selected, onOpen }: {
  brawler: Brawler; selected: boolean; onOpen: () => void;
}) {
  return <button type="button" className={`brawler-card rarity-${brawler.rarity} ${brawler.owned ? 'owned' : 'locked'} ${selected ? 'selected' : ''}`} style={{ borderTopColor: rarityTone[brawler.rarity] ?? '#91a4bc' }} onClick={onOpen}>
    <span className="brawler-art"><span className="brawler-portrait">{brawler.image}</span><small>{brawler.rarity}</small>{brawler.freeToday && !brawler.owned && <i>오늘 무료</i>}<b className="brawler-lock-mark">{brawler.owned ? selected ? '출전 중' : '보유' : '잠김'}</b></span>
    <span className="brawler-card-copy"><span><strong>{brawler.name}</strong>{selected && <i className="brawler-selected-badge">선택됨</i>}</span><span>{brawler.attackStyle}</span><small>체력 {brawler.hp} · 공격 {brawler.attack} · 이동 {brawler.speed}</small><small className="brawler-special">{brawler.specialName}</small><b className="brawler-open-link">{brawler.owned ? '상세 정보 보기' : `상세 정보 · 💎 ${brawler.price}`}</b></span>
  </button>;
}
function BrawlerQuizModal({ quiz, question, questionIndex, feedback, busy, error, onAnswer, onNext, onClose }: {
  quiz: QuizChallenge; question?: BrawlerQuestion; questionIndex: number; feedback: QuizFeedback | null;
  busy: boolean; error: string; onAnswer: (answerIndex: number) => void; onNext: () => void; onClose: () => void;
}) {
  const completed = Boolean(feedback?.completed);
  return <div className="quiz-modal-backdrop"><section className="panel brawler-quiz-modal">
    <button className="quiz-close" aria-label="퀴즈 닫기" onClick={onClose}>×</button>
    {completed && feedback ? <div className={`brawler-quiz-result ${feedback.passed ? 'passed' : 'failed'}`}>
      <span className="quiz-result-avatar">{feedback.passed ? quiz.brawler.image : '📚'}</span>
      <span className="eyebrow">{feedback.passed ? 'BRAWLER UNLOCKED' : 'KEEP LEARNING'}</span>
      <h2>{feedback.passed ? `${quiz.brawler.name} 획득!` : '아쉽지만 다시 도전할 수 있어요'}</h2>
      <p>정답 {feedback.correctCount} / {feedback.total} · 통과 기준 {quiz.brawler.requiredCorrect}개</p>
      {feedback.passed && <p>{quiz.brawler.rarity} 브롤러를 계정에 영구 저장했어요.</p>}
      <button className="primary-button" onClick={onClose}>브롤러 목록으로</button>
    </div> : question ? <>
      <div className="quiz-modal-head"><span className="quiz-result-avatar">{quiz.brawler.image}</span><div>
        <span className="eyebrow">{quiz.brawler.rarity} BRAWLER QUIZ</span><h2>{quiz.brawler.name} 획득 퀴즈</h2>
        <small>문제 {questionIndex + 1} / {quiz.questions.length} · 정답 {feedback?.correctCount ?? 0} · 통과 {quiz.brawler.requiredCorrect}개 이상</small>
      </div></div>
      <div className="quiz-question-card"><div className="quiz-question-meta"><span>{question.subject}</span><span>{question.difficulty === 'easy' ? '쉬움' : question.difficulty === 'medium' ? '보통' : '도전'}</span></div>
        <h3>{question.question}</h3>
        <div className="brawler-answer-grid">{question.options.map((option, index) => <button key={`${question.id}-${index}`} disabled={Boolean(feedback) || busy}
          className={`brawler-answer-option ${feedback && option === feedback.correctAnswer ? 'answer-correct' : ''}`}
          onClick={() => onAnswer(index)}><i>{String.fromCharCode(65 + index)}</i>{option}</button>)}</div>
        {feedback && <div className={`answer-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}><b>{feedback.correct ? '정답이에요!' : `오답 · 정답은 ${feedback.correctAnswer}`}</b><p>{feedback.explanation}</p></div>}
      </div>
      {error && <p className="inline-error">{error}</p>}
      {feedback && !completed && <button className="primary-button wide" disabled={busy} onClick={onNext}>다음 문제 <ArrowRight size={15} /></button>}
    </> : <p className="empty-note">문제를 불러오고 있어요.</p>}
  </section></div>;
}
function ArenaGame({ user, refreshUser, notify }: { user: User; refreshUser: () => Promise<void>; notify: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());
  const pointers = useRef(new Map<number, ArenaPointer>());
  const controls = useRef({ moveX: 0, moveY: 0, aimX: 1, aimY: 0, firing: false, basicQueued: false, specialQueued: false, mouseX: 0, mouseY: 0 });
  const state = useRef<ShooterState | null>(null);
  const [board, setBoard] = useState<BrawlerBoard | null>(null);
  const [tab, setTab] = useState<'collection' | 'shop' | 'battle'>('collection');
  const [shop, setShop] = useState<ArenaShopState | null>(null);
  const [shopBusy, setShopBusy] = useState(false);
  const [detailBrawler, setDetailBrawler] = useState<Brawler | null>(null);
  const [rarityFilter, setRarityFilter] = useState('전체');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'owned' | 'locked'>('all');
  const [sortOrder, setSortOrder] = useState<'rarity' | 'name' | 'power'>('rarity');
  const [mode, setMode] = useState<GameMode>('idle');
  const [hud, setHud] = useState({ hp: 100, maxHp: 100, attack: 14, energy: 0, score: 0, wave: 1, specialCooldown: 0 });
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | 'abandoned' | null>(null);
  const [controlsHud, setControlsHud] = useState({ moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
  const [quiz, setQuiz] = useState<QuizChallenge | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizFeedback, setQuizFeedback] = useState<QuizFeedback | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [error, setError] = useState('');
  const [gameError, setGameError] = useState('');
  const [message, setMessage] = useState('');
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const loadBrawlers = useCallback(async () => {
    setBoard(await api<BrawlerBoard>('/api/game/brawlers'));
  }, []);
  const loadArenaShop = useCallback(async () => {
    setShop(await api<ArenaShopState>('/api/game/shop'));
  }, []);
  useEffect(() => { void loadBrawlers().catch(reason => setError(reason instanceof Error ? reason.message : '브롤러 정보를 불러오지 못했습니다.')); }, [loadBrawlers]);
  useEffect(() => { void loadArenaShop().catch(reason => setError(reason instanceof Error ? reason.message : '아레나 상점을 불러오지 못했습니다.')); }, [loadArenaShop]);
  const updateJoystick = useCallback((pointerId: number, x: number, y: number) => {
    const pointer = pointers.current.get(pointerId);
    if (!pointer) return;
    const dx = x - pointer.originX, dy = y - pointer.originY, length = Math.max(1, Math.hypot(dx, dy));
    const magnitude = Math.min(1, length / 48), vx = dx / length * magnitude, vy = dy / length * magnitude;
    if (pointer.zone === 'move') {
      controls.current.moveX = vx; controls.current.moveY = vy;
      setControlsHud(current => ({ ...current, moveX: vx, moveY: vy }));
    } else {
      controls.current.aimX = vx; controls.current.aimY = vy;
      setControlsHud(current => ({ ...current, aimX: vx, aimY: vy }));
    }
  }, []);
  const onCanvasDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (event.pointerType === 'mouse') {
      controls.current.mouseX = x; controls.current.mouseY = y;
      const player = state.current?.player;
      if (player) {
        const dx = x - player.x, dy = y - player.y, length = Math.hypot(dx, dy) || 1;
        controls.current.aimX = dx / length; controls.current.aimY = dy / length; controls.current.basicQueued = true;
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const zone = x < rect.width / 2 ? 'move' : 'aim';
    const compactPortrait = window.matchMedia('(max-width: 620px)').matches;
    const compactLandscape = window.matchMedia('(orientation: landscape) and (max-width: 900px)').matches;
    const offset = compactPortrait ? Math.min(47, rect.width * .13) : compactLandscape ? 43 : 72;
    const bottomOffset = compactPortrait ? 49 : compactLandscape ? 41 : 71;
    pointers.current.set(event.pointerId, { zone, originX: zone === 'move' ? offset : rect.width - offset, originY: rect.height - bottomOffset });
    updateJoystick(event.pointerId, x, y);
  };
  const onCanvasMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === 'mouse') {
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      controls.current.mouseX = x; controls.current.mouseY = y;
      const player = state.current?.player;
      if (player) {
        const dx = x - player.x, dy = y - player.y, length = Math.hypot(dx, dy) || 1;
        controls.current.aimX = dx / length; controls.current.aimY = dy / length;
      }
    } else updateJoystick(event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
  };
  const onCanvasUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse') return;
    const pointer = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (pointer?.zone === 'move') {
      controls.current.moveX = 0; controls.current.moveY = 0;
      setControlsHud(current => ({ ...current, moveX: 0, moveY: 0 }));
    } else if (pointer?.zone === 'aim') setControlsHud(current => ({ ...current, aimX: 0, aimY: 0 }));
  };
  const finishGame = useCallback((reason = '활동 종료', result: 'victory' | 'defeat' | 'abandoned' = 'abandoned') => {
    const game = state.current;
    if (!game || game.mode !== 'playing') return;
    game.mode = 'over'; setMode('over');
    setGameResult(result);
    void api<{ coins: number; xp: number; gems: number; rewardsLimited: boolean }>('/api/game/finish', json({ runId: game.runId, score: game.score }))
      .then(async reward => {
        const [latest] = await Promise.all([api<BrawlerBoard>('/api/game/brawlers'), loadArenaShop(), refreshUser()]);
        setBoard(latest);
        notify(`${reason} · +${reward.coins} 코인 · +${reward.gems} 보석 · +${reward.xp} XP`);
      }).catch(failure => setGameError(failure instanceof Error ? failure.message : '게임 결과를 저장하지 못했습니다.'));
  }, [loadArenaShop, notify, refreshUser]);
  async function selectBrawler(brawler: Brawler) {
    if (!brawler.owned || brawler.id === board?.selectedBrawlerId) return;
    setError('');
    try { await api('/api/game/brawlers/select', json({ brawlerId: brawler.id })); await loadBrawlers(); setDetailBrawler(null); notify(`${brawler.name} 브롤러를 선택했어요.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '브롤러를 선택하지 못했습니다.'); }
  }
  async function buyBrawler(brawler: Brawler, limited = false) {
    setError(''); setShopBusy(true);
    try {
      await api('/api/game/shop/buy-brawler', json({ brawlerId: brawler.id, limited }));
      await Promise.all([loadBrawlers(), loadArenaShop()]);
      setDetailBrawler(null);
      notify(`${brawler.name} 브롤러를 영구 보유했어요.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '브롤러를 구매하지 못했습니다.'); }
    finally { setShopBusy(false); }
  }
  async function claimArenaGift() {
    setShopBusy(true); setError('');
    try {
      await api('/api/game/shop/claim', json({}));
      await Promise.all([loadArenaShop(), loadBrawlers(), refreshUser()]);
      notify('무료 보상을 받았어요. +25 코인 · +5 보석');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '무료 보상을 받지 못했습니다.'); }
    finally { setShopBusy(false); }
  }
  async function exchangeCurrency(direction: 'coinsToGems' | 'gemsToCoins') {
    setShopBusy(true); setError('');
    try {
      await api('/api/game/shop/exchange', json({ direction }));
      await Promise.all([loadArenaShop(), loadBrawlers(), refreshUser()]);
      notify(direction === 'coinsToGems' ? '100 코인을 10 보석으로 교환했어요.' : '10 보석을 100 코인으로 교환했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '재화를 교환하지 못했습니다.'); }
    finally { setShopBusy(false); }
  }
  async function startChallenge(brawler: Brawler) {
    setError(''); setQuizFeedback(null); setQuizBusy(true);
    try {
      const result = await api<QuizChallenge>('/api/game/brawlers/challenge', json({ brawlerId: brawler.id }));
      setDetailBrawler(null); setQuiz(result); setQuizIndex(0); setQuizFeedback(null); setBoard(current => current ? { ...current, gems: result.gems } : current);
      void loadArenaShop();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '퀴즈를 시작하지 못했습니다.'); }
    finally { setQuizBusy(false); }
  }
  async function answerQuestion(answerIndex: number) {
    if (!quiz || quizFeedback || quizBusy) return;
    setQuizBusy(true);
    try {
      const result = await api<QuizFeedback>('/api/game/brawlers/answer', {
        method: 'POST', body: JSON.stringify({ challengeToken: quiz.challengeToken, questionIndex: quizIndex, answerIndex })
      });
      setQuizFeedback(result); setBoard(current => current ? { ...current, gems: result.gems } : current);
      if (result.completed) {
        if (result.passed && result.brawler) {
          notify(`${result.brawler.rarity} 브롤러 ${result.brawler.name}을(를) 영구 획득했어요!`);
        }
        await loadBrawlers();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '답안을 제출하지 못했습니다.'); }
    finally { setQuizBusy(false); }
  }
  async function startGame() {
    setGameError(''); setMessage('');
    try {
      const { runId, playerStats } = await api<{ runId: string; playerStats: { maxHp: number; power: number; speed: number; color: string; brawler: Pick<Brawler, 'id' | 'name' | 'rarity' | 'image' | 'attackStyle' | 'specialName' | 'special' | 'kit'> } }>('/api/game/start', json({}));
      const canvas = canvasRef.current, width = canvas?.clientWidth ?? 800, height = canvas?.clientHeight ?? 460;
      const brawler = board?.brawlers.find(item => item.id === playerStats.brawler.id) ?? {
        ...playerStats.brawler, hp: playerStats.maxHp, attack: playerStats.power, speed: playerStats.speed,
        color: playerStats.color, requiredCorrect: 0, freeDay: null, freeToday: false, price: 0, owned: true
      };
      state.current = {
        player: { x: width / 2, y: height / 2, hp: playerStats.maxHp, maxHp: playerStats.maxHp, energy: 0, speed: playerStats.speed, attack: playerStats.power, color: playerStats.color, brawler, shield: 0 },
        enemies: [], bullets: [], drops: [], damageNumbers: [], score: 0, wave: 1, elapsed: 0, spawnTimer: .5, dropTimer: 8,
        fireTimer: 0, specialCooldown: 0, startedAt: Date.now(), runId, mode: 'playing', lastFrame: 0
      };
      controls.current = { ...controls.current, moveX: 0, moveY: 0, firing: false, basicQueued: false, specialQueued: false };
      keys.current.clear(); pointers.current.clear(); setControlsHud({ moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
      setHud({ hp: playerStats.maxHp, maxHp: playerStats.maxHp, attack: playerStats.power, energy: 0, score: 0, wave: 1, specialCooldown: 0 });
      setGameResult(null);
      setTab('battle'); setMode('playing');
    } catch (reason) { setGameError(reason instanceof Error ? reason.message : '전투를 시작할 수 없습니다.'); }
  }
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const context = canvasElement.getContext('2d');
    if (!context) return;
    const canvas = canvasElement;
    let frame = 0, lastHudAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const key = event.key.toLowerCase(); keys.current.add(key);
      if (key === 'q' && state.current?.mode === 'playing') controls.current.specialQueued = true;
      if (key === ' ' && state.current?.mode === 'playing') controls.current.firing = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.key.toLowerCase());
      if (event.key === ' ') controls.current.firing = false;
    };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    const resize = () => {
      const currentCanvas = canvasRef.current; if (!currentCanvas) return;
      const ratio = window.devicePixelRatio || 1;
      currentCanvas.width = currentCanvas.clientWidth * ratio; currentCanvas.height = currentCanvas.clientHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const spawnEnemy = (game: ShooterState, width: number, height: number) => {
      const edge = Math.floor(Math.random() * 4);
      const x = edge === 0 ? 8 : edge === 1 ? width - 8 : Math.random() * width;
      const y = edge === 2 ? 8 : edge === 3 ? height - 8 : Math.random() * height;
      const kind = Math.random() < .23 + Math.min(.25, game.wave * .02) ? 'sprinter' : Math.random() < .22 ? 'thinker' : 'drifter';
      const hp = (kind === 'thinker' ? 65 : kind === 'sprinter' ? 25 : 39) + game.wave * 3;
      game.enemies.push({ x, y, hp, maxHp: hp, speed: (kind === 'thinker' ? 42 : kind === 'sprinter' ? 105 : 63) + game.wave * 1.6, radius: kind === 'thinker' ? 18 : 13, color: kind === 'thinker' ? '#f2b565' : kind === 'sprinter' ? '#e879a5' : '#9d87ef', attackCooldown: 0, kind });
    };
    const fire = (game: ShooterState, angle: number, offset = 0) => {
      const player = game.player, kit = player.brawler.kit;
      const count = kit === 'fan' ? 3 : kit === 'orbit' ? 2 : 1;
      for (let shot = 0; shot < count; shot++) {
        const spread = count === 3 ? (shot - 1) * .22 : count === 2 ? (shot ? .13 : -.13) : 0;
        const direction = angle + spread + offset;
        const speed = kit === 'cone' ? 330 : kit === 'beam' ? 670 : kit === 'return' ? 310 : kit === 'comet' ? 560 : kit === 'wave' ? 270 : 470;
        game.bullets.push({
          x: player.x + Math.cos(direction) * 20, y: player.y + Math.sin(direction) * 20,
          vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed,
          life: kit === 'cone' ? .42 : kit === 'return' ? 1.4 : 1,
          damage: player.attack * (count === 3 ? .62 : count === 2 ? .72 : 1),
          piercing: kit === 'beam', returnAt: kit === 'return' ? .42 : 99, returning: false, hitEnemies: new Set()
        });
      }
    };
    const special = (game: ShooterState, angle: number, width: number, height: number) => {
      const player = game.player, kit = player.brawler.kit;
      if (player.energy < 45 || game.specialCooldown > 0) return;
      player.energy -= 45; game.specialCooldown = player.brawler.id === 'haeul' ? 7 : 9;
      if (kit === 'seed') player.shield = 3;
      else if (kit === 'cone') {
        player.x = Math.max(20, Math.min(width - 20, player.x + Math.cos(angle) * 100));
        player.y = Math.max(20, Math.min(height - 20, player.y + Math.sin(angle) * 100)); player.shield = 1.2;
      } else if (kit === 'return' || kit === 'orbit') {
        player.hp = Math.min(player.maxHp, player.hp + 42); player.energy = Math.min(100, player.energy + 10);
      } else {
        const radius = kit === 'beam' ? 200 : 115;
        for (const enemy of game.enemies) {
          const dx = enemy.x - player.x, dy = enemy.y - player.y, distance = Math.hypot(dx, dy);
          if (distance > radius) continue;
          if (kit === 'beam' && dx * Math.cos(angle) + dy * Math.sin(angle) < 0) continue;
          const damage = player.attack * 2.8;
          enemy.hp = Math.max(0, enemy.hp - damage);
          game.damageNumbers.push({ x: enemy.x, y: enemy.y - enemy.radius, amount: damage, life: .75, color: '#ffe6a1' });
          const push = kit === 'wave' || kit === 'fan';
          if (push && distance > 0) { enemy.x += dx / distance * 48; enemy.y += dy / distance * 48; }
        }
      }
    };
    function draw(time: number) {
      frame = requestAnimationFrame(draw);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const game = state.current, dt = game?.lastFrame ? Math.min(.05, (time - game.lastFrame) / 1000) : 0;
      if (game) game.lastFrame = time;
      const ctx = context;
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#090e20'; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(107, 126, 201, .08)'; ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 0; y < height; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      if (game?.mode === 'playing') {
        const player = game.player;
        game.elapsed += dt; game.wave = Math.min(5, Math.floor(game.elapsed / 20) + 1);
        player.shield = Math.max(0, player.shield - dt);
        const keyX = (keys.current.has('d') || keys.current.has('arrowright') ? 1 : 0) - (keys.current.has('a') || keys.current.has('arrowleft') ? 1 : 0);
        const keyY = (keys.current.has('s') || keys.current.has('arrowdown') ? 1 : 0) - (keys.current.has('w') || keys.current.has('arrowup') ? 1 : 0);
        const moveX = controls.current.moveX || keyX, moveY = controls.current.moveY || keyY, moveLength = Math.hypot(moveX, moveY) || 1;
        player.x = Math.max(20, Math.min(width - 20, player.x + moveX / moveLength * player.speed * dt));
        player.y = Math.max(20, Math.min(height - 20, player.y + moveY / moveLength * player.speed * dt));
        const pointerAim = !isTouch && (controls.current.mouseX || controls.current.mouseY);
        if (pointerAim) {
          const dx = controls.current.mouseX - player.x, dy = controls.current.mouseY - player.y, length = Math.hypot(dx, dy) || 1;
          controls.current.aimX = dx / length; controls.current.aimY = dy / length;
        }
        const aimAngle = Math.atan2(controls.current.aimY, controls.current.aimX);
        game.fireTimer -= dt; game.specialCooldown = Math.max(0, game.specialCooldown - dt);
        if (controls.current.specialQueued) { controls.current.specialQueued = false; special(game, aimAngle, width, height); }
        if (controls.current.basicQueued) { controls.current.basicQueued = false; fire(game, aimAngle); game.fireTimer = .28; }
        else if ((controls.current.firing || (isTouch && pointers.current.has(-1))) && game.fireTimer <= 0) {
          fire(game, aimAngle); game.fireTimer = player.brawler.kit === 'comet' ? .13 : player.brawler.kit === 'cone' ? .48 : .31;
        }
        game.spawnTimer -= dt;
        if (game.spawnTimer <= 0) {
          const count = Math.min(4, 1 + Math.floor(game.wave / 2));
          for (let index = 0; index < count; index++) spawnEnemy(game, width, height);
          game.spawnTimer = Math.max(.55, 2.1 - game.wave * .09);
        }
        game.dropTimer -= dt;
        if (game.dropTimer <= 0 && game.drops.length < 5) {
          game.drops.push({ x: 25 + Math.random() * Math.max(1, width - 50), y: 25 + Math.random() * Math.max(1, height - 50), kind: (['health', 'energy', 'growth'] as const)[Math.floor(Math.random() * 3)], life: 15 });
          game.dropTimer = Math.max(3, 10 - game.elapsed / 120);
        }
        game.drops = game.drops.filter(drop => {
          drop.life -= dt;
          if (Math.hypot(drop.x - player.x, drop.y - player.y) < 24) {
            if (drop.kind === 'health') player.hp = Math.min(player.maxHp, player.hp + 30);
            if (drop.kind === 'energy') player.energy = Math.min(100, player.energy + 35);
            if (drop.kind === 'growth') { player.attack += 2; player.speed = Math.min(330, player.speed + 12); }
            setMessage(drop.kind === 'health' ? '컨디션을 회복했어요!' : drop.kind === 'energy' ? '특수 에너지를 채웠어요!' : '성장 아이템을 획득했어요!');
            return false;
          }
          return drop.life > 0;
        });
        game.bullets = game.bullets.filter(bullet => {
          bullet.life -= dt;
          if (bullet.returning) {
            const dx = player.x - bullet.x, dy = player.y - bullet.y, length = Math.hypot(dx, dy) || 1;
            bullet.vx = dx / length * 390; bullet.vy = dy / length * 390;
            if (length < 22) bullet.life = -1;
          } else if (bullet.returnAt < 1) {
            bullet.returnAt -= dt; if (bullet.returnAt <= 0) bullet.returning = true;
          }
          bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt;
          for (const enemy of game.enemies) {
            if (enemy.hp > 0 && !bullet.hitEnemies.has(enemy) && Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < enemy.radius + 5) {
              bullet.hitEnemies.add(enemy);
              enemy.hp = Math.max(0, enemy.hp - bullet.damage);
              game.damageNumbers.push({ x: enemy.x, y: enemy.y - enemy.radius, amount: bullet.damage, life: .75, color: '#ffffff' });
              player.energy = Math.min(100, player.energy + 5);
              if (!bullet.piercing) { bullet.life = -1; break; }
            }
          }
          return bullet.life > 0 && bullet.x > -20 && bullet.x < width + 20 && bullet.y > -20 && bullet.y < height + 20;
        });
        game.enemies = game.enemies.filter(enemy => {
          if (enemy.hp <= 0) { game.score += enemy.kind === 'thinker' ? 45 : enemy.kind === 'sprinter' ? 30 : 25; return false; }
          const dx = player.x - enemy.x, dy = player.y - enemy.y, length = Math.hypot(dx, dy) || 1;
          enemy.x += dx / length * enemy.speed * dt; enemy.y += dy / length * enemy.speed * dt;
          enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
          if (length < enemy.radius + 17) {
            if (enemy.attackCooldown <= 0) {
              enemy.attackCooldown = .5;
              if (player.shield <= 0) {
                const damage = enemy.kind === 'thinker' ? 17 : 10;
                player.hp = Math.max(0, player.hp - damage);
                game.damageNumbers.push({ x: player.x, y: player.y - 24, amount: damage, life: .75, color: '#ff8296' });
              }
            }
            if (enemy.kind === 'sprinter') { enemy.x -= dx / length * 35 * dt; enemy.y -= dy / length * 35 * dt; }
          }
          return true;
        });
        if (player.hp <= 0) {
          player.hp = 0;
          setHud({ hp: 0, maxHp: player.maxHp, attack: player.attack, energy: player.energy, score: game.score, wave: game.wave, specialCooldown: game.specialCooldown });
          finishGame('전투 패배', 'defeat');
        } else if (game.elapsed >= 100) finishGame('5 웨이브 생존 승리', 'victory');
        if (time - lastHudAt > 110) {
          lastHudAt = time;
          setHud({ hp: player.hp, maxHp: player.maxHp, attack: player.attack, energy: player.energy, score: game.score, wave: game.wave, specialCooldown: game.specialCooldown });
        }
      }
      if (game) {
        for (const drop of game.drops) {
          const colors = { health: '#61d69a', energy: '#66d8f6', growth: '#f3c779' };
          ctx.beginPath(); ctx.arc(drop.x, drop.y, 13, 0, Math.PI * 2); ctx.fillStyle = `${colors[drop.kind]}30`; ctx.fill(); ctx.strokeStyle = colors[drop.kind]; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = colors[drop.kind]; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(drop.kind === 'health' ? '+' : drop.kind === 'energy' ? 'ϟ' : '✦', drop.x, drop.y);
        }
        for (const bullet of game.bullets) {
          ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.piercing ? 5 : 4, 0, Math.PI * 2); ctx.fillStyle = game.player.color; ctx.shadowColor = game.player.color; ctx.shadowBlur = 9; ctx.fill(); ctx.shadowBlur = 0;
        }
        for (const enemy of game.enemies) {
          ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 5, 0, Math.PI * 2); ctx.fillStyle = `${enemy.color}22`; ctx.fill();
          ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2); ctx.fillStyle = enemy.color; ctx.fill();
          ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
          ctx.fillStyle = '#283149'; ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 7, enemy.radius * 2, 3);
          ctx.fillStyle = '#71ddb5'; ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 7, enemy.radius * 2 * Math.max(0, enemy.hp / enemy.maxHp), 3);
          ctx.fillStyle = '#f4f4fa'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(`${Math.ceil(enemy.hp)} / ${enemy.maxHp} HP`, enemy.x, enemy.y - enemy.radius - 9);
        }
        game.damageNumbers = game.damageNumbers.filter(damage => {
          damage.life -= dt; damage.y -= 28 * dt;
          ctx.save(); ctx.globalAlpha = Math.min(1, damage.life / .2); ctx.fillStyle = damage.color;
          ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = '#080b14'; ctx.shadowBlur = 4;
          ctx.fillText(`-${damage.amount.toFixed(1)}`, damage.x, damage.y); ctx.restore();
          return damage.life > 0;
        });
        const player = game.player, angle = Math.atan2(controls.current.aimY, controls.current.aimX);
        ctx.save(); ctx.translate(player.x, player.y);
        if (player.shield > 0) { ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.strokeStyle = '#a998ff'; ctx.lineWidth = 3; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fillStyle = `${player.color}35`; ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fillStyle = player.color; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '17px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(player.brawler.image, 0, 1);
        ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(21, 0); ctx.lineTo(13, -5); ctx.lineTo(13, 5); ctx.closePath(); ctx.fillStyle = '#f4e3a8'; ctx.fill(); ctx.restore();
      } else {
        ctx.fillStyle = '#141d31'; ctx.beginPath(); ctx.arc(width / 2, height / 2, 30, 0, Math.PI * 2); ctx.fill();
        const chosen = board?.brawlers.find(item => item.id === board.selectedBrawlerId) ?? board?.brawlers[0];
        if (chosen) { ctx.font = '34px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(chosen.image, width / 2, height / 2); }
      }
    }
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [board, finishGame, isTouch, tab]);
  const useAbility = (ability: 'basic' | 'special') => {
    if (mode !== 'playing') return;
    if (ability === 'basic') controls.current.basicQueued = true;
    else controls.current.specialQueued = true;
  };
  async function showBattle() {
    if (!board?.owned.length) { setError('전투에 출전할 브롤러를 먼저 획득해 주세요.'); return; }
    setTab('battle');
  }
  const currentQuestion = quiz?.questions[quizIndex];
  const selectedBrawler = board?.brawlers.find(item => item.id === board.selectedBrawlerId);
  const rarityOrder = ['일반', '희귀', '초희귀', '영웅', '신화', '전설'];
  const visibleBrawlers = [...(board?.brawlers ?? [])]
    .filter(brawler => rarityFilter === '전체' || brawler.rarity === rarityFilter)
    .filter(brawler => ownershipFilter === 'all' || (ownershipFilter === 'owned' ? brawler.owned : !brawler.owned))
    .sort((a, b) => sortOrder === 'name'
      ? a.name.localeCompare(b.name, 'ko')
      : sortOrder === 'power'
        ? b.attack - a.attack
        : rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity) || a.name.localeCompare(b.name, 'ko'));
  const detail = board?.brawlers.find(item => item.id === detailBrawler?.id) ?? detailBrawler;
  return <div className="page-stack">
    <div className="page-title arena-title"><div><span className="eyebrow">BRAWLER COLLECTION · COSMIC ARENA</span><h1>브롤러 아레나</h1><p>나만의 브롤러를 살펴보고, 아레나 활동을 준비해요.</p></div><div className="arena-wallet"><span><Coins size={16} /> {user.coins.toLocaleString()}</span><span><Sparkles size={16} /> {board?.gems ?? 0}</span></div></div>
    <div className="brawler-tabs"><button className={tab === 'collection' ? 'active' : ''} onClick={() => { if (mode !== 'playing') setTab('collection'); }}>브롤러 선택 {board ? `(${board.owned.length}/${board.brawlers.length})` : ''}</button><button className={tab === 'shop' ? 'active' : ''} onClick={() => { if (mode !== 'playing') { setTab('shop'); void loadArenaShop(); } }}>아레나 상점</button><button className={tab === 'battle' ? 'active' : ''} onClick={() => void showBattle()}>전투 아레나</button>{selectedBrawler && <span>출전 브롤러 <b>{selectedBrawler.image} {selectedBrawler.name}</b></span>}</div>
    {tab === 'collection' && <section className="panel brawler-collection"><div className="panel-heading"><div><span className="eyebrow">STUDY TO UNLOCK</span><h2>나만의 브롤러</h2></div><span className="gem-balance"><Sparkles size={15} /> {board?.gems ?? 0} 보석</span></div>
      {board?.freeBrawlerId && <div className="daily-brawler-banner"><span>오늘의 무료 브롤러 퀴즈</span><b>{weekdayNames[board.weekday]} · {board.brawlers.find(item => item.id === board.freeBrawlerId)?.name}</b><small>통과하면 영구 보유 · 실패해도 오늘 다시 도전할 수 있어요.</small></div>}
      <div className="brawler-filters"><label>등급<select value={rarityFilter} onChange={event => setRarityFilter(event.target.value)}>{['전체', ...rarityOrder].map(rarity => <option key={rarity}>{rarity}</option>)}</select></label><label>보유 상태<select value={ownershipFilter} onChange={event => setOwnershipFilter(event.target.value as typeof ownershipFilter)}><option value="all">전체 브롤러</option><option value="owned">보유 중</option><option value="locked">미보유</option></select></label><label>정렬<select value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)}><option value="rarity">등급 순</option><option value="name">이름 순</option><option value="power">공격력 순</option></select></label></div>
      <div className="brawler-grid">{visibleBrawlers.map(brawler => <BrawlerCard key={brawler.id} brawler={brawler} selected={board?.selectedBrawlerId === brawler.id} onOpen={() => setDetailBrawler(brawler)} />)}</div>
      <p className="brawler-footnote">첫 탐험가에게 보석 120개를 드려요. 아레나 활동 보상으로 하루 최대 25개를 모을 수 있습니다. 일반·희귀·초희귀·영웅·신화·전설 등급의 브롤러는 능력과 획득 퀴즈가 달라요.</p>
    </section>}
    {tab === 'shop' && shop && <section className="arena-shop">
      <section className="arena-shop-feature"><div><span className="eyebrow">TODAY IN THE COSMIC MARKET</span><h2>탐험을 위한 보급 상점</h2><p>활동으로 모은 코인과 보석으로 브롤러를 영입하고 재화를 교환해요.</p></div><div className="arena-shop-wallet"><span><Coins size={16} /> {shop.coins.toLocaleString()} 코인</span><span><Sparkles size={16} /> {shop.gems} 보석</span></div></section>
      <div className="arena-shop-grid">
        <article className="arena-offer-card daily-offer"><span className="arena-offer-icon">✦</span><span className="eyebrow">DAILY SUPPLY · 무료</span><h3>오늘의 탐험 보급품</h3><p>하루 한 번 코인 25개와 보석 5개를 받을 수 있어요.</p><button className="primary-button compact" disabled={shopBusy || shop.dailyRewardClaimed} onClick={() => void claimArenaGift()}>{shop.dailyRewardClaimed ? '오늘 수령 완료' : '무료 보상 받기'}</button></article>
        <article className="arena-offer-card exchange-offer"><span className="arena-offer-icon">⇄</span><span className="eyebrow">DAILY EXCHANGE</span><h3>재화 교환</h3><p>각 교환 방향은 하루 한 번 이용할 수 있어요.</p><div className="exchange-buttons"><button disabled={shopBusy || shop.exchanges.coinsToGems || shop.coins < 100} onClick={() => void exchangeCurrency('coinsToGems')}><Coins size={14} /> 100 → <Sparkles size={14} /> 10</button><button disabled={shopBusy || shop.exchanges.gemsToCoins || shop.gems < 10} onClick={() => void exchangeCurrency('gemsToCoins')}><Sparkles size={14} /> 10 → <Coins size={14} /> 100</button></div></article>
        <article className="arena-offer-card limited-offer"><span className="limited-ribbon">오늘의 기간 한정</span><span className="limited-avatar">{shop.limitedOffer.brawler.image}</span><span className="eyebrow">{shop.limitedOffer.brawler.rarity} · LIMITED RECRUIT</span><h3>{shop.limitedOffer.brawler.name}</h3><p>{shop.limitedOffer.brawler.attackStyle}</p><div className="limited-price"><del>💎 {shop.limitedOffer.brawler.price}</del><b>💎 {shop.limitedOffer.price}</b></div><button className="primary-button compact" disabled={shopBusy || shop.limitedOffer.brawler.owned || shop.gems < shop.limitedOffer.price} onClick={() => void buyBrawler(shop.limitedOffer.brawler, true)}>{shop.limitedOffer.brawler.owned ? '이미 보유 중' : shop.gems < shop.limitedOffer.price ? '보석 부족' : '한정 영입'}</button></article>
      </div>
      <section className="panel arena-shop-brawlers"><div className="panel-heading"><div><span className="eyebrow">BRAWLER RECRUITMENT</span><h2>보석으로 영입</h2></div><span className="gem-balance"><Sparkles size={15} /> {shop.gems} 보석</span></div><div className="arena-product-grid">{board?.brawlers.filter(brawler => !brawler.owned && brawler.price > 0).map(brawler => <article className={`arena-product rarity-${brawler.rarity}`} key={brawler.id}><span className="arena-product-avatar">{brawler.image}</span><div><b>{brawler.name}</b><small>{brawler.rarity} · {brawler.attackStyle}</small></div><button disabled={shopBusy || shop.gems < brawler.price} onClick={() => void buyBrawler(brawler)}>{shop.gems < brawler.price ? '보석 부족' : <><Sparkles size={13} /> {brawler.price}</>}</button></article>)}</div><p className="brawler-footnote">브롤러를 바로 영입하거나, 수집 화면에서 학습 퀴즈에 도전해 획득할 수도 있어요. 유료 결제는 연결되어 있지 않으며 재화는 게임 활동으로 획득합니다.</p></section>
    </section>}
    {tab === 'battle' && <section className="game-shell brawler-battle-shell">
      <div className="battle-hud"><div className="battle-player-tag"><span>{selectedBrawler?.image ?? '🐰'}</span><div><b>{selectedBrawler?.name ?? '모모'}</b><small>{selectedBrawler?.attackStyle}</small></div></div><div className="battle-meter"><Heart size={15} /><div><span>HP {Math.ceil(hud.hp)} / {hud.maxHp}</span><i><b style={{ width: `${Math.min(100, hud.hp / hud.maxHp * 100)}%` }} /></i></div></div><div className="battle-meter energy"><Zap size={15} /><div><span>특수 에너지 {Math.floor(hud.energy)}%</span><i><b style={{ width: `${hud.energy}%` }} /></i></div></div><span className="battle-stat"><Target size={14} /> 피해 {hud.attack}</span><span className="battle-stat"><Trophy size={14} /> WAVE {hud.wave}/5 · {hud.score.toLocaleString()}</span>{mode === 'playing' && <button className="battle-end-button" onClick={() => finishGame()}>전투 종료</button>}</div>
      <div className="game-canvas-wrap battle-canvas-wrap"><canvas ref={canvasRef} className="game-canvas battle-canvas" onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerCancel={onCanvasUp} aria-label="탑다운 브롤러 아레나" />
        {mode !== 'playing' && <div className="game-overlay battle-overlay"><div className="game-overlay-card battle-overlay-card"><span className="game-logo">{selectedBrawler?.image ?? '🐰'}</span><span className="eyebrow">{mode === 'over' ? gameResult === 'victory' ? 'ARENA VICTORY' : gameResult === 'defeat' ? 'ARENA DEFEAT' : 'BATTLE ENDED' : 'READY, BRAWLER?'}</span><h2>{mode === 'over' ? gameResult === 'victory' ? '5 웨이브 생존 성공!' : gameResult === 'defeat' ? '체력이 모두 소진됐어요' : '전투를 종료했어요' : '우주 탐험 아레나'}</h2><p>{selectedBrawler?.specialName ?? '새싹 보호막'} · {selectedBrawler?.special ?? '가까운 적을 밀어내요.'}<br />5 웨이브 동안 생존하면 승리해요. 적의 체력과 피해량은 전투 화면에 표시돼요.<br />WASD와 방향 조작으로 움직이고, 클릭해 기본 능력을 사용하세요.</p><button className="primary-button" onClick={() => void startGame()}>{mode === 'over' ? '다시 출전' : '전투 시작'} <ArrowRight size={16} /></button>{gameError && <p className="inline-error">{gameError}</p>}</div></div>}
        {mode === 'playing' && isTouch && <div className="touch-controls battle-controls" aria-label="전투 터치 조작"><div className={`virtual-stick move-stick ${Math.hypot(controlsHud.moveX, controlsHud.moveY) > .05 ? 'active' : ''}`}><span style={{ transform: `translate(${controlsHud.moveX * 25}px, ${controlsHud.moveY * 25}px)` }} /><small>이동</small></div><div className={`virtual-stick aim-stick ${Math.hypot(controlsHud.aimX, controlsHud.aimY) > .05 ? 'active' : ''}`}><span style={{ transform: `translate(${controlsHud.aimX * 25}px, ${controlsHud.aimY * 25}px)` }} /><small>조준</small></div><button className="battle-action basic-action" onPointerDown={event => { event.preventDefault(); controls.current.firing = true; }} onPointerUp={event => { event.preventDefault(); controls.current.firing = false; }} onPointerCancel={() => { controls.current.firing = false; }}><Crosshair size={19} /><small>기본 능력</small></button><button className="battle-action special-action" onClick={() => useAbility('special')} disabled={hud.energy < 45 || hud.specialCooldown > 0}><Sparkles size={19} /><small>{hud.specialCooldown > 0 ? `${hud.specialCooldown.toFixed(1)}초` : '특수 능력 · Q'}</small></button></div>}
      </div>
      <div className="game-footer battle-footer"><span><i className="legend-dot" /> 탐험 몬스터 <i className="legend-dot cyan" /> 회복·성장 아이템</span><span>{isTouch ? '이동·조준 조이스틱 · 기본 능력 · 특수 능력' : 'WASD 이동 · 마우스 조준/클릭 공격 · Space 연속 공격 · Q 특수 능력'}</span></div>
    </section>}
    {tab === 'battle' && selectedBrawler && <section className="panel battle-skill-card"><div className="skill-avatar">{selectedBrawler.image}</div><div><span className="eyebrow">ACTIVE BRAWLER · {selectedBrawler.rarity}</span><h2>{selectedBrawler.specialName}</h2><p>{selectedBrawler.special} 기본 공격: {selectedBrawler.attackStyle} · 공격 {hud.attack} · 속도 {selectedBrawler.speed}</p></div></section>}
    {detail && <div className="brawler-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailBrawler(null); }}><section className={`brawler-detail-card rarity-${detail.rarity}`} role="dialog" aria-modal="true" aria-label={`${detail.name} 상세 정보`}><button className="quiz-close" aria-label="상세 정보 닫기" onClick={() => setDetailBrawler(null)}>×</button><div className="brawler-detail-art"><span>{detail.image}</span><i>{detail.owned ? detail.id === board?.selectedBrawlerId ? '현재 출전 중' : '보유 브롤러' : '잠금 상태'}</i></div><span className="eyebrow" style={{ color: rarityTone[detail.rarity] }}>{detail.rarity} · {detail.freeToday ? '오늘 무료 퀴즈' : '우주 탐험가'}</span><h2>{detail.name}</h2><p className="brawler-detail-style">{detail.attackStyle}</p><div className="brawler-stat-grid"><span><small>체력</small><b><Heart size={14} /> {detail.hp}</b></span><span><small>공격력</small><b><Target size={14} /> {detail.attack}</b></span><span><small>이동 속도</small><b><Zap size={14} /> {detail.speed}</b></span></div><div className="brawler-ability-copy"><b>일반 능력</b><p>{detail.attackStyle} 방식으로 아레나를 탐험해요.</p><b>{detail.specialName}</b><p>{detail.special}</p></div><div className="brawler-detail-actions">{detail.owned ? <button className="primary-button wide" disabled={detail.id === board?.selectedBrawlerId} onClick={() => void selectBrawler(detail)}>{detail.id === board?.selectedBrawlerId ? '현재 출전 브롤러' : '이 브롤러 선택'}</button> : <><button className="brawler-challenge-button" disabled={quizBusy || (!detail.freeToday && (board?.gems ?? 0) < detail.price)} onClick={() => void startChallenge(detail)}>{detail.freeToday ? '무료 학습 퀴즈 도전' : `학습 퀴즈 도전 · 💎 ${detail.price}`}</button>{detail.price > 0 && <button className="primary-button wide" disabled={shopBusy || (board?.gems ?? 0) < detail.price} onClick={() => void buyBrawler(detail)}>{(board?.gems ?? 0) < detail.price ? '보석이 부족해요' : `보석 ${detail.price}개로 잠금 해제`}</button>}</>}</div>{error && <p className="inline-error">{error}</p>}</section></div>}
    {quiz && <BrawlerQuizModal quiz={quiz} question={currentQuestion} questionIndex={quizIndex} feedback={quizFeedback} busy={quizBusy} error={error} onAnswer={index => void answerQuestion(index)} onNext={() => { setQuizIndex(index => index + 1); setQuizFeedback(null); }} onClose={() => { setQuiz(null); setQuizFeedback(null); setError(''); }} />}
    {message && !quiz && <div className="brawler-toast"><Sparkles size={15} />{message}<button onClick={() => setMessage('')} aria-label="알림 닫기">×</button></div>}
    {error && !quiz && <p className="inline-error">{error}<button onClick={() => setError('')} aria-label="오류 닫기">×</button></p>}
  </div>;
}

function ShopPage({ user, refreshUser, notify }: { user: User; refreshUser: () => Promise<void>; notify: (message: string) => void }) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const data = await api<{ items: StoreItem[]; inventory: InventoryItem[]; purchases: PurchaseRecord[] }>('/api/shop');
    setItems(data.items); setInventory(data.inventory); setPurchases(data.purchases);
  }, []);
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [load]);
  async function buy(item: StoreItem) {
    setError('');
    try { await api('/api/shop/buy', json({ itemId: item.id })); await Promise.all([load(), refreshUser()]); notify(`${item.name} 구매 완료!`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '구매에 실패했습니다.'); }
  }
  async function equip(item: StoreItem, equipped: boolean) {
    try { await api('/api/shop/equip', json({ itemId: item.id, equipped })); await load(); notify(equipped ? `${item.name} 장착 완료` : `${item.name} 장착 해제`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '장비를 변경하지 못했습니다.'); }
  }
  const owned = useMemo(() => new Map(inventory.map(item => [item.itemId, item])), [inventory]);
  return <div className="page-stack">
    <div className="page-title"><div><span className="eyebrow">GALACTIC MARKET</span><h1>상점 & 장비</h1><p>플레이 보상 코인으로 장비를 업그레이드하세요.</p></div><span className="title-badge coin-badge"><Coins size={17} /> {user.coins.toLocaleString()} 코인</span></div>
    <section className="shop-feature"><div><span className="eyebrow">EQUIP YOUR NEXT RUN</span><h2>다음 탐험을 준비하세요.</h2><p>무기와 능력을 강화하고 나만의 우주 스타일을 완성해요.</p></div><div className="feature-stars"><span>✦</span><span>✧</span><span>·</span></div></section>
    <div className="shop-grid">{items.map((item, index) => {
      const itemOwned = owned.get(item.id);
      const atMax = (itemOwned?.quantity ?? 0) >= item.max;
      const equipped = Boolean(itemOwned?.equipped);
      return <article className="panel shop-item" key={item.id}>
        <div className={`item-art art-${index}`}><span>{item.category === 'weapon' ? <Crosshair size={29} /> : item.category === 'skin' ? <Sparkles size={29} /> : <Zap size={29} />}</span><i>✦</i></div>
        <div className="shop-item-content">
          <span className="item-category">{item.category === 'weapon' ? '무기 업그레이드' : item.category === 'skin' ? '캐릭터 스킨' : '능력 업그레이드'}</span>
          <h3>{item.name}</h3><p>{item.description}</p>
          <div className="item-footer"><span><Coins size={14} /> {item.price}</span>
            {item.category === 'skin' ? itemOwned
              ? <div className="owned-actions"><small>보유</small><button className={equipped ? 'secondary-button' : 'primary-button compact'} onClick={() => void equip(item, !equipped)}>{equipped ? '장착 중' : '장착'}</button></div>
              : <button className="primary-button compact" disabled={user.coins < item.price} onClick={() => void buy(item)}>구매하기</button>
              : <div className="owned-actions"><small>{itemOwned ? `${itemOwned.quantity}/${item.max} 강화` : '미보유'}</small><button className="primary-button compact" disabled={user.coins < item.price || atMax} onClick={() => void buy(item)}>{atMax ? '최대 강화' : itemOwned ? '강화하기' : '구매하기'}</button></div>}
          </div>
        </div>
      </article>;
    })}</div>
    <section className="panel inventory-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR LOADOUT</span><h2>내 인벤토리</h2></div><ShoppingBag size={18} className="muted-icon" /></div><div className="inventory-row">{inventory.length ? inventory.map(item => <span className="inventory-chip" key={item.itemId}><Check size={14} />{items.find(entry => entry.id === item.itemId)?.name ?? item.itemId}<small>×{item.quantity}</small>{item.equipped ? <b>장착 중</b> : null}</span>) : <p className="empty-note">아직 보유한 아이템이 없어요. 코스믹 아레나 보상으로 코인을 모아보세요.</p>}</div></section>
    <section className="panel inventory-panel"><div className="panel-heading"><div><span className="eyebrow">PURCHASE LOG</span><h2>최근 구매 내역</h2></div><Clock3 size={18} className="muted-icon" /></div>{purchases.length ? <div className="purchase-list">{purchases.map((purchase, index) => <div className="purchase-row" key={`${purchase.purchasedAt}-${index}`}><span>{purchase.itemName}</span><small>{new Date(purchase.purchasedAt).toLocaleString('ko-KR')}</small><b>{purchase.currency === 'gems' ? <Sparkles size={13} /> : <Coins size={13} />} {purchase.price} {purchase.currency === 'gems' ? '보석' : '코인'}</b></div>)}</div> : <p className="empty-note">구매한 아이템이 여기에 기록됩니다.</p>}</section>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function ProfilePage({ user, onUpdate, onLogout, notify }: { user: User; onUpdate: (user: User) => void; onLogout: () => void; notify: (message: string) => void }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [avatar, setAvatar] = useState(user.avatar);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const result = await api<{ user: User }>('/api/profile', { method: 'PATCH', body: JSON.stringify({ nickname, avatar }) });
      onUpdate(result.user); notify('프로필을 저장했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장에 실패했습니다.'); }
  }
  return <div className="page-stack">
    <div className="page-title"><div><span className="eyebrow">EXPLORER PROFILE</span><h1>내 프로필</h1><p>나만의 학습 우주 정보를 관리해요.</p></div><span className="title-badge"><Award size={17} /> LEVEL {user.level}</span></div>
    <div className="profile-grid">
      <section className="panel profile-card"><div className="profile-cover"><span>✦</span><span>✧</span><span>·</span></div><Avatar user={user} size="lg" /><h2>{user.nickname}</h2><p className="user-id">ID · {user.userId}</p><div className="profile-xp"><span>레벨 {user.level}</span><span>{user.xp % 100} / 100 XP</span><i><b style={{ width: `${user.xp % 100}%` }} /></i></div><div className="profile-stats"><span><Coins size={16} />{user.coins} 코인</span><span><Sparkles size={16} />총 {user.xp} XP</span></div></section>
      <section className="panel profile-edit"><div className="panel-heading"><div><span className="eyebrow">PERSONALIZE</span><h2>프로필 편집</h2></div><UserRound size={18} className="muted-icon" /></div><form className="stack-form" onSubmit={save}><label>닉네임<input value={nickname} onChange={event => setNickname(event.target.value)} minLength={2} maxLength={24} required /></label><label>프로필 이미지 URL<input type="url" value={avatar} onChange={event => setAvatar(event.target.value)} placeholder="https://example.com/avatar.png" /></label><label>로그인 이름<input value={user.loginName || '이전할 수 없는 기존 계정'} disabled /></label><button className="primary-button wide">변경사항 저장 <Check size={16} /></button></form>{error && <p className="inline-error">{error}</p>}<button className="logout-button" onClick={onLogout}><LogOut size={16} /> 로그아웃</button></section>
    </div>
  </div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [missions, setMissions] = useState<DailyMission[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  const refreshMissions = useCallback(async () => {
    const result = await api<{ missions: DailyMission[] }>('/api/missions');
    setMissions(result.missions);
  }, []);
  const refreshUser = useCallback(async () => {
    const profile = await api<{ user: User | null }>('/api/auth/me');
    if (!profile.user) {
      setUser(null);
      setMissions([]);
      return;
    }
    setUser(profile.user);
    await refreshMissions();
  }, [refreshMissions]);
  useEffect(() => {
    void refreshUser().catch(() => setUser(null)).finally(() => setLoading(false));
  }, [refreshUser]);
  useEffect(() => {
    if (user) void refreshMissions().catch(reason => notify(reason instanceof Error ? reason.message : '미션을 불러오지 못했습니다.'));
  }, [user?.id, refreshMissions, notify]);
  useEffect(() => {
    if (!user) { socket?.disconnect(); setSocket(null); return; }
    const connection = io({ withCredentials: true });
    setSocket(connection);
    return () => { connection.disconnect(); };
  }, [user?.id]);
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    socket?.disconnect(); setSocket(null); setUser(null); setMissions([]); setPage('home');
  }
  async function claimMission(mission: DailyMission) {
    try {
      const reward = await api<{ coins: number; xp: number }>(`/api/missions/${mission.id}/claim`, json({}));
      await refreshUser();
      notify(`미션 보상 +${reward.coins} 코인 · +${reward.xp} XP`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '미션 보상을 받지 못했습니다.');
    }
  }
  if (loading) return <div className="boot-screen"><div className="boot-mark"><Sparkles size={21} /></div><span>STUDYVERSE PRO</span><i /></div>;
  if (!user) return <AuthScreen onLogin={setUser} />;
  const currentPage = navItems.find(item => item.id === page);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('home'); }}><span className="brand-mark"><Sparkles size={19} /></span><span>STUDYVERSE<small>PRO</small></span></a>
      <div className="workspace-label">MY UNIVERSE</div>
      <nav className="main-nav">{navItems.map(item => { const Icon = item.icon; return <button className={`nav-link ${page === item.id ? 'active' : ''}`} key={item.id} onClick={() => setPage(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === 'arena' && <i className="nav-new">LIVE</i>}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="sidebar-mission"><span className="mission-orbit"><Target size={17} /></span><strong>{missions.find(mission => mission.completed && !mission.claimed)?.title ?? missions[0]?.title ?? '오늘의 미션'}</strong><p>{missions.find(mission => mission.completed && !mission.claimed)?.detail ?? missions[0]?.detail ?? '오늘의 탐험을 시작해요.'}</p><div className="mission-progress"><i style={{ width: `${missions[0] ? Math.min(100, missions[0].progress / missions[0].target * 100) : 0}%` }} /></div>{missions.some(mission => mission.completed && !mission.claimed) ? <button className="sidebar-claim" onClick={() => { const mission = missions.find(item => item.completed && !item.claimed); if (mission) void claimMission(mission); }}>보상 받기</button> : <small>{missions.filter(mission => mission.claimed).length} / {missions.length} 미션 보상 완료</small>}</div><button className="profile-mini" onClick={() => setPage('profile')}><Avatar user={user} size="sm" /><span><b>{user.nickname}</b><small>레벨 {user.level} 탐험가</small></span><ChevronDown size={15} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>MY UNIVERSE</span><ArrowRight size={13} /><b>{currentPage?.label ?? '프로필'}</b></div><div className="topbar-actions"><span className="topbar-date">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span><span className="topbar-level"><Sparkles size={14} /> LV.{user.level}</span><button className="avatar-button" onClick={() => setPage('profile')} title="프로필"><Avatar user={user} size="sm" /></button></div></header>
      <div className="content-area">
        {page === 'home' && <Dashboard user={user} refreshUser={refreshUser} notify={notify} missions={missions} onClaim={claimMission} />}
        {page === 'study' && <StudyPlanner refreshUser={refreshUser} notify={notify} />}
        {page === 'quiz' && <QuizPage refreshUser={refreshUser} notify={notify} />}
        {page === 'friends' && <FriendsPage user={user} socket={socket} notify={notify} />}
        {page === 'arena' && <ArenaGame user={user} refreshUser={refreshUser} notify={notify} />}
        {page === 'shop' && <ShopPage user={user} refreshUser={refreshUser} notify={notify} />}
        {page === 'profile' && <ProfilePage user={user} onUpdate={setUser} onLogout={() => void logout()} notify={notify} />}
        <footer className="app-footer"><span>STUDYVERSE PRO</span><span>배움과 모험이 만나는 우주 <i>✦</i></span></footer>
      </div>
    </main>
    {toast && <Toast message={toast} onClose={() => setToast('')} />}
    <nav className="mobile-nav">{navItems.map(item => { const Icon = item.icon; const labels: Record<Page, string> = { home: '홈', study: '학습', quiz: '퀴즈', friends: '친구', arena: '아레나', shop: '상점', profile: '프로필' }; return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><Icon size={18} /><small>{labels[item.id]}</small></button>; })}</nav>
  </div>;
}
